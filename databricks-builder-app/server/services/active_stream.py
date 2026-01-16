"""Active stream manager for async agent execution.

Handles background execution of Claude agent with event accumulation
and cursor-based pagination for polling.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


@dataclass
class StreamEvent:
    """A single event from the agent stream."""

    timestamp: float
    data: dict[str, Any]


@dataclass
class ActiveStream:
    """Manages a background agent execution with event accumulation.

    Events are stored in an append-only list for cursor-based retrieval.
    The stream can be cancelled, and cleanup happens automatically.
    """

    execution_id: str
    conversation_id: str
    project_id: str
    events: list[StreamEvent] = field(default_factory=list)
    is_complete: bool = False
    is_cancelled: bool = False
    error: str | None = None
    task: asyncio.Task | None = None
    created_at: float = field(default_factory=time.time)

    def add_event(self, event_data: dict[str, Any]) -> None:
        """Add an event to the stream."""
        self.events.append(StreamEvent(
            timestamp=time.time(),
            data=event_data,
        ))

    def get_events_since(self, cursor: float = 0.0) -> tuple[list[dict[str, Any]], float]:
        """Get all events since the given cursor timestamp.

        Args:
            cursor: Timestamp to get events after (exclusive)

        Returns:
            Tuple of (events list, new cursor timestamp)
        """
        new_events = [
            e.data for e in self.events
            if e.timestamp > cursor
        ]

        # Return the timestamp of the last event as new cursor
        new_cursor = self.events[-1].timestamp if self.events else cursor
        return new_events, new_cursor

    def mark_complete(self) -> None:
        """Mark the stream as complete."""
        self.is_complete = True
        self.add_event({'type': 'stream.completed', 'is_error': False})

    def mark_error(self, error: str) -> None:
        """Mark the stream as failed with an error."""
        self.error = error
        self.is_complete = True
        self.add_event({'type': 'error', 'error': error})
        self.add_event({'type': 'stream.completed', 'is_error': True})

    def cancel(self) -> bool:
        """Cancel the stream if it's still running.

        Returns:
            True if cancellation was initiated, False if already complete/cancelled
        """
        if self.is_complete or self.is_cancelled:
            return False

        self.is_cancelled = True
        if self.task and not self.task.done():
            self.task.cancel()

        self.add_event({'type': 'stream.cancelled'})
        self.add_event({'type': 'stream.completed', 'is_error': False})
        self.is_complete = True
        return True


class ActiveStreamManager:
    """Manages multiple active streams with automatic cleanup."""

    # Streams older than this will be cleaned up (5 minutes)
    CLEANUP_THRESHOLD_SECONDS = 300

    def __init__(self):
        self._streams: dict[str, ActiveStream] = {}
        self._lock = asyncio.Lock()

    async def create_stream(
        self,
        project_id: str,
        conversation_id: str,
    ) -> ActiveStream:
        """Create a new active stream.

        Args:
            project_id: Project ID
            conversation_id: Conversation ID

        Returns:
            New ActiveStream instance
        """
        execution_id = str(uuid.uuid4())

        stream = ActiveStream(
            execution_id=execution_id,
            conversation_id=conversation_id,
            project_id=project_id,
        )

        async with self._lock:
            self._streams[execution_id] = stream
            await self._cleanup_old_streams()

        logger.info(f"Created active stream {execution_id} for conversation {conversation_id}")
        return stream

    async def get_stream(self, execution_id: str) -> ActiveStream | None:
        """Get a stream by execution ID."""
        async with self._lock:
            return self._streams.get(execution_id)

    async def remove_stream(self, execution_id: str) -> None:
        """Remove a stream from the manager."""
        async with self._lock:
            if execution_id in self._streams:
                del self._streams[execution_id]
                logger.info(f"Removed active stream {execution_id}")

    async def _cleanup_old_streams(self) -> None:
        """Remove streams older than the cleanup threshold."""
        now = time.time()
        to_remove = [
            eid for eid, stream in self._streams.items()
            if stream.is_complete and (now - stream.created_at) > self.CLEANUP_THRESHOLD_SECONDS
        ]

        for eid in to_remove:
            del self._streams[eid]
            logger.debug(f"Cleaned up old stream {eid}")

        if to_remove:
            logger.info(f"Cleaned up {len(to_remove)} old streams")

    async def start_stream(
        self,
        stream: ActiveStream,
        agent_coroutine: Callable[[], Coroutine[Any, Any, None]],
    ) -> None:
        """Start the agent execution in the background.

        Args:
            stream: The ActiveStream to populate with events
            agent_coroutine: Async function that yields events
        """
        async def run_agent():
            try:
                await agent_coroutine()
            except asyncio.CancelledError:
                logger.info(f"Stream {stream.execution_id} was cancelled")
                if not stream.is_complete:
                    stream.is_cancelled = True
                    stream.is_complete = True
            except Exception as e:
                logger.error(f"Stream {stream.execution_id} error: {e}")
                if not stream.is_complete:
                    stream.mark_error(str(e))

        stream.task = asyncio.create_task(run_agent())
        logger.info(f"Started agent task for stream {stream.execution_id}")


# Global singleton instance
_manager: ActiveStreamManager | None = None


def get_stream_manager() -> ActiveStreamManager:
    """Get the global ActiveStreamManager instance."""
    global _manager
    if _manager is None:
        _manager = ActiveStreamManager()
    return _manager
