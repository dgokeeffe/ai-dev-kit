#!/usr/bin/env python3
"""
Local testing script for Databricks Natural Language Builder

Tests the app functionality without requiring full Databricks authentication.
"""
import sys
import requests
import time
import subprocess
import signal
import os

def test_app():
    """Test the application endpoints"""
    base_url = "http://127.0.0.1:8080"

    print("🧪 Testing Databricks Natural Language Builder\n")

    # Test 1: Health Check
    print("1️⃣  Testing health endpoint...")
    try:
        response = requests.get(f"{base_url}/api/health", timeout=5)
        data = response.json()
        print(f"   ✅ Health: {data['status']}")
        print(f"   📊 Active sessions: {data['active_sessions']}")
        print(f"   🤖 LLM initialized: {data['llm_initialized']}")
        if not data['llm_initialized']:
            print("   ⚠️  LLM not initialized (expected without Databricks auth)")
    except Exception as e:
        print(f"   ❌ Health check failed: {e}")
        return False

    # Test 2: UI Loading
    print("\n2️⃣  Testing UI endpoint...")
    try:
        response = requests.get(f"{base_url}/", timeout=5)
        if "Databricks Natural Language Builder" in response.text:
            print("   ✅ UI loads successfully")
            print("   🎨 Vue.js chat interface ready")
        else:
            print("   ❌ UI content unexpected")
    except Exception as e:
        print(f"   ❌ UI test failed: {e}")
        return False

    # Test 3: Session Management
    print("\n3️⃣  Testing session endpoint...")
    try:
        response = requests.get(f"{base_url}/api/sessions", timeout=5)
        data = response.json()
        print(f"   ✅ Sessions endpoint working")
        print(f"   📋 Total sessions: {len(data['sessions'])}")
    except Exception as e:
        print(f"   ❌ Session test failed: {e}")
        return False

    # Test 4: Tool Registry
    print("\n4️⃣  Testing tool imports...")
    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from tools.registry import get_all_tool_definitions, get_tool_handlers
        tools = get_all_tool_definitions()
        handlers = get_tool_handlers()
        print(f"   ✅ Tool registry working")
        print(f"   🔧 Total tools: {len(tools)}")
        print(f"   🎯 Total handlers: {len(handlers)}")
        print(f"   📦 Sample tools:")
        for tool in tools[:5]:
            name = tool['function']['name']
            desc = tool['function']['description']
            print(f"      - {name}: {desc[:50]}...")
    except Exception as e:
        print(f"   ❌ Tool registry test failed: {e}")
        return False

    print("\n✅ All tests passed!")
    print(f"\n🌐 App running at: {base_url}")
    print("   Open in browser to test the chat UI")
    return True

def start_app():
    """Start the app in background"""
    print("🚀 Starting application...")
    process = subprocess.Popen(
        ["python3", "app.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    time.sleep(3)  # Wait for startup
    return process

def main():
    """Main test runner"""
    app_process = None

    try:
        # Start app
        app_process = start_app()

        # Run tests
        success = test_app()

        if success:
            print("\n" + "="*60)
            print("✨ Application is ready!")
            print("="*60)
            print("\nNext steps:")
            print("  1. Open http://localhost:8080 in your browser")
            print("  2. Configure Databricks authentication to enable LLM")
            print("  3. Try example prompts in the UI")
            print("\nPress Ctrl+C to stop the server...")

            # Keep running
            try:
                app_process.wait()
            except KeyboardInterrupt:
                print("\n\n👋 Shutting down...")

    except KeyboardInterrupt:
        print("\n\n👋 Shutting down...")
    finally:
        if app_process:
            app_process.terminate()
            app_process.wait()

if __name__ == "__main__":
    main()
