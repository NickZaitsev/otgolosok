package online.otgolosok.walk_service

import android.os.Looper
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import online.otgolosok.walk_service.player.WalkForwardingPlayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WalkForwardingPlayerTest {
    /** A single-item player that records what reached it. */
    private class RecordingPlayer : SimpleBasePlayer(Looper.getMainLooper()) {
        val calls = mutableListOf<String>()
        var commands: Player.Commands = Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PREPARE).build()

        fun refresh() = invalidateState()

        override fun getState(): State = State.Builder().setAvailableCommands(commands).build()

        override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
            calls += "playWhenReady=$playWhenReady"
            return Futures.immediateVoidFuture()
        }

        override fun handlePrepare(): ListenableFuture<*> {
            calls += "prepare"
            return Futures.immediateVoidFuture()
        }

        override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
            calls += "seek"
            return Futures.immediateVoidFuture()
        }

        override fun handleStop(): ListenableFuture<*> {
            calls += "stop"
            return Futures.immediateVoidFuture()
        }
    }

    @Test
    fun `transport commands go to Dart and never reach ExoPlayer`() {
        val cases = listOf<Pair<(Player) -> Unit, MediaCommand>>(
            { p: Player -> p.play() } to MediaCommand(MediaCommandKind.PLAY),
            { p: Player -> p.pause() } to MediaCommand(MediaCommandKind.PAUSE),
            { p: Player -> p.playWhenReady = true } to MediaCommand(MediaCommandKind.PLAY),
            { p: Player -> p.seekToNext() } to MediaCommand(MediaCommandKind.NEXT),
            { p: Player -> p.seekToNextMediaItem() } to MediaCommand(MediaCommandKind.NEXT),
            { p: Player -> p.seekToPrevious() } to MediaCommand(MediaCommandKind.PREVIOUS),
            { p: Player -> p.seekToPreviousMediaItem() } to MediaCommand(MediaCommandKind.PREVIOUS),
            { p: Player -> p.seekBack() } to MediaCommand(MediaCommandKind.SEEK_BY, -15_000),
            { p: Player -> p.seekTo(42_000) } to MediaCommand(MediaCommandKind.SEEK_TO, 42_000),
            { p: Player -> p.stop() } to MediaCommand(MediaCommandKind.STOP),
        )
        for ((action, expected) in cases) {
            val wrapped = RecordingPlayer()
            val commands = mutableListOf<MediaCommand>()
            action(WalkForwardingPlayer(wrapped) { commands += it })
            assertEquals(listOf(expected), commands)
            assertEquals("ExoPlayer must stay untouched for $expected", emptyList<String>(), wrapped.calls)
        }
    }

    @Test
    fun `session prepare and default position seek are no-ops`() {
        val wrapped = RecordingPlayer()
        val commands = mutableListOf<MediaCommand>()
        val player = WalkForwardingPlayer(wrapped) { commands += it }
        player.prepare()
        player.seekToDefaultPosition()
        assertEquals(emptyList<MediaCommand>(), commands)
        assertEquals(emptyList<String>(), wrapped.calls)
    }

    @Test
    fun `previous and next are advertised for a single item`() {
        val player = WalkForwardingPlayer(RecordingPlayer()) {}
        for (command in listOf(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_BACK, Player.COMMAND_STOP)) {
            assertTrue("command $command", player.isCommandAvailable(command))
            assertTrue("command $command", player.availableCommands.contains(command))
        }
    }

    @Test
    fun `listeners see the advertised commands when the player changes its own`() {
        val wrapped = RecordingPlayer()
        val player = WalkForwardingPlayer(wrapped) {}
        val reported = mutableListOf<Player.Commands>()
        val listener = object : Player.Listener {
            override fun onAvailableCommandsChanged(availableCommands: Player.Commands) {
                reported += availableCommands
            }
        }
        player.addListener(listener)
        // SimpleBasePlayer takes its initial state lazily; the change below must be a change.
        wrapped.refresh()
        wrapped.commands = Player.Commands.Builder().add(Player.COMMAND_PLAY_PAUSE).build()
        wrapped.refresh()
        shadowOf(Looper.getMainLooper()).idle()

        assertTrue(reported.isNotEmpty())
        assertTrue(reported.last().contains(Player.COMMAND_SEEK_TO_NEXT))
        assertTrue(reported.last().contains(Player.COMMAND_SEEK_TO_PREVIOUS))

        player.removeListener(listener)
        wrapped.commands = Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_STOP).build()
        val before = reported.size
        wrapped.refresh()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("removed listener must not be called", before, reported.size)
    }
}
