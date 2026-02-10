# Life of a Query: Databricks Azure Token Vending Flow

This document details the authentication and token vending flow for Databricks on Azure, including how VMs/clusters in the data plane obtain tokens from the control plane, the role of Entra ID (Azure AD), and how Private Link fits into the architecture.

## Architecture overview

```
+---------------------------+     +---------------------------+
|      CONTROL PLANE        |     |        DATA PLANE         |
|   (Databricks-managed)    |     |   (Customer subscription) |
+---------------------------+     +---------------------------+
| - Web Application         |     | - Cluster VMs (Driver +   |
| - REST API                |     |   Workers)                |
| - Cluster Manager         |     | - Workspace VNet          |
| - SCC Relay Service       |     | - NAT Gateway / Firewall  |
| - Token Vending Service   |     | - DBFS Storage            |
+---------------------------+     +---------------------------+
            ^                                  |
            |      Microsoft Azure Backbone    |
            +----------------------------------+
```

## Sequence diagram: VM bootstrap and token vending

```mermaid
sequenceDiagram
    autonumber
    participant User as User/Admin
    participant EntraID as Microsoft Entra ID
    participant CP as Control Plane<br/>(Databricks-managed)
    participant Relay as SCC Relay Service<br/>(Control Plane)
    participant VM as Cluster VM<br/>(Data Plane)
    participant Storage as Azure Storage<br/>(DBFS/ADLS)

    Note over User,Storage: Phase 1: User authentication to workspace

    User->>EntraID: 1. Login request (SSO/SAML 2.0)
    EntraID->>EntraID: Validate credentials
    EntraID->>User: 2. Return Entra ID token (JWT)<br/>expires in 60-90 min
    User->>CP: 3. Access workspace with Entra ID token
    CP->>CP: Validate token, check permissions
    CP->>User: 4. Return workspace session

    Note over User,Storage: Phase 2: Cluster creation request

    User->>CP: 5. Create cluster request<br/>(via UI or REST API)
    CP->>CP: 6. Allocate resources,<br/>prepare VM configuration
    CP->>VM: 7. Provision VM in customer VNet<br/>(via Azure Resource Manager)

    Note over User,Storage: Phase 3: VM bootstrap and authentication

    rect rgb(240, 248, 255)
        Note right of VM: VM Bootstrap Process
        VM->>VM: 8. VM starts, init scripts run
        VM->>EntraID: 9. Request token using<br/>Managed Identity (MI)<br/>(per-VM credential signed by Azure AD)
        EntraID->>EntraID: Validate MI credential
        EntraID->>VM: 10. Return MI token (JWT)
        VM->>CP: 11. Authenticate to control plane<br/>using MI token (HTTPS/443)
        CP->>CP: 12. Validate MI token,<br/>verify workspace membership
        CP->>VM: 13. Return secrets bundle:<br/>- Relay auth token<br/>- Workspace config<br/>- TLS certificates
    end

    Note over User,Storage: Phase 4: Establish SCC relay connection

    rect rgb(255, 248, 240)
        Note right of VM: Secure Cluster Connectivity (SCC)
        VM->>Relay: 14. Initiate outbound connection<br/>(HTTPS/443, TLS encrypted)<br/>Authenticate with relay token
        Relay->>Relay: 15. Validate per-workspace<br/>auth token
        Relay->>VM: 16. Establish persistent tunnel<br/>(reverse tunnel for admin commands)
        Note over Relay,VM: All control plane commands<br/>flow through this tunnel
    end

    Note over User,Storage: Phase 5: Ongoing cluster operations

    User->>CP: 17. Submit job/query
    CP->>Relay: 18. Route command to cluster
    Relay->>VM: 19. Forward via reverse tunnel
    VM->>VM: 20. Execute Spark job

    Note over User,Storage: Phase 6: Storage access with credential vending

    rect rgb(240, 255, 240)
        Note right of VM: Unity Catalog Credential Vending
        VM->>CP: 21. Request storage credentials<br/>(for Unity Catalog table access)
        CP->>CP: 22. Check user permissions,<br/>generate scoped credentials
        CP->>VM: 23. Return short-lived credentials:<br/>- SAS token or<br/>- Temporary access token<br/>- Scoped storage URL
        VM->>Storage: 24. Access data with<br/>temporary credentials
        Storage->>VM: 25. Return data
    end

    VM->>Relay: 26. Return results via tunnel
    Relay->>CP: 27. Forward results
    CP->>User: 28. Display results
```

## Sequence diagram: Private Link architecture

```mermaid
sequenceDiagram
    autonumber
    participant User as User<br/>(Corporate Network)
    participant FW as Transit VNet<br/>(Firewall/Hub)
    participant FE_PE as Frontend PE<br/>(databricks_ui_api)
    participant Auth_PE as Browser Auth PE<br/>(browser_authentication)
    participant EntraID as Microsoft Entra ID
    participant CP as Control Plane
    participant BE_PE as Backend PE<br/>(databricks_ui_api)
    participant VM as Cluster VM<br/>(Workspace VNet)

    Note over User,VM: Frontend Private Link - User to Workspace

    User->>FW: 1. Access Databricks workspace
    FW->>FE_PE: 2. Route through frontend<br/>private endpoint
    FE_PE->>CP: 3. Connect via Microsoft backbone<br/>(no public internet)

    Note over User,VM: Browser authentication callback

    CP->>EntraID: 4. Redirect for SSO
    EntraID->>User: 5. Auth challenge
    User->>EntraID: 6. Provide credentials
    EntraID->>Auth_PE: 7. SSO callback via<br/>browser_authentication PE
    Auth_PE->>CP: 8. Complete authentication
    CP->>FE_PE: 9. Return session
    FE_PE->>User: 10. Workspace access granted

    Note over User,VM: Backend Private Link - Cluster to Control Plane

    rect rgb(255, 248, 240)
        Note right of VM: Cluster Bootstrap with Backend PE
        VM->>VM: 11. VM starts in workspace VNet
        VM->>EntraID: 12. Get MI token<br/>(via Azure IMDS endpoint)
        EntraID->>VM: 13. Return MI token
        VM->>BE_PE: 14. Connect to control plane<br/>via backend private endpoint
        BE_PE->>CP: 15. Route over Microsoft backbone
        CP->>BE_PE: 16. Return secrets + relay token
        BE_PE->>VM: 17. Receive configuration
    end

    Note over User,VM: SCC Relay via Private Link

    VM->>BE_PE: 18. Establish SCC tunnel<br/>via backend PE
    BE_PE->>CP: 19. Connect to SCC relay<br/>(different IP than webapp)
    CP->>BE_PE: 20. Tunnel established
    BE_PE->>VM: 21. Ready for commands

    Note over User,VM: End-to-end private traffic flow

    User->>FE_PE: 22. Submit query
    FE_PE->>CP: 23. Route to control plane
    CP->>BE_PE: 24. Forward to cluster via relay
    BE_PE->>VM: 25. Execute on cluster
    VM->>BE_PE: 26. Return results
    BE_PE->>CP: 27. Via relay
    CP->>FE_PE: 28. To user
    FE_PE->>User: 29. Display results
```

## Token types and lifetimes

| Token Type | Issued By | Lifetime | Purpose |
|------------|-----------|----------|---------|
| Entra ID User Token | Microsoft Entra ID | 60-90 minutes | User authentication to workspace |
| Managed Identity Token | Microsoft Entra ID | ~1 hour | VM authentication to control plane |
| Relay Auth Token | Databricks Control Plane | Session-based | Authenticate VM to SCC relay |
| Unity Catalog Credential | Databricks Control Plane | Short-lived (minutes) | Scoped access to cloud storage |
| Databricks OAuth Token | Databricks OIDC endpoint | Matches source token | API access after token exchange |

## Key security properties

### Secure Cluster Connectivity (SCC)
- **No public IPs**: Cluster VMs have no public IP addresses
- **No inbound ports**: Customer VNet has no open inbound ports
- **Outbound only**: All connections initiated by cluster (outbound HTTPS/443)
- **Reverse tunnel**: Control plane commands sent via reverse tunnel
- **TLS encrypted**: All traffic encrypted with Databricks server certificates

### Private Link benefits
- **Frontend PE**: User traffic never traverses public internet
- **Backend PE**: Cluster-to-control plane traffic stays on Microsoft backbone
- **Browser Auth PE**: SSO callbacks handled privately (required for frontend PE)
- **DNS resolution**: Private DNS zones route to private IPs

## Network flow summary

### Without Private Link (SCC only)
```
User --> [Internet] --> Control Plane
Cluster VM --> [Azure Backbone] --> Control Plane (via NAT Gateway)
```

### With Frontend Private Link only
```
User --> [Private Network] --> Frontend PE --> [Azure Backbone] --> Control Plane
Cluster VM --> [Azure Backbone] --> Control Plane (via NAT Gateway, public endpoint)
```

### With Backend Private Link only
```
User --> [Internet] --> Control Plane
Cluster VM --> Backend PE --> [Azure Backbone] --> Control Plane
```

### End-to-end Private Link
```
User --> [Private Network] --> Frontend PE --> [Azure Backbone] --> Control Plane
Cluster VM --> Backend PE --> [Azure Backbone] --> Control Plane
(No public internet exposure at any point)
```

## References

- [Azure Private Link concepts - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/private-link)
- [High-level architecture - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/getting-started/high-level-architecture)
- [Enable secure cluster connectivity - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/secure-cluster-connectivity)
- [Configure back-end private connectivity - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/private-link-standard)
- [Unity Catalog credential vending - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/external-access/credential-vending)
- [Authenticate with identity provider token exchange - Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-federation-exchange)
- [Databricks on Azure - An Architecture Perspective (Bluetab)](https://www.bluetab.net/en/databricks-on-azure-an-architecture-perspective-part-1/)
- [VM bootstrap and authentication (Databricks Community)](https://community.databricks.com/t5/data-engineering/vm-bootstrap-and-authentication-when-a-vm-boots-up-it/td-p/19742)
