package online.otgolosok.walk_service.player

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import online.otgolosok.walk_service.MediaCommand
import online.otgolosok.walk_service.MediaCommandKind

/**
 * The player the media session sees. Transport commands from the lock screen, the notification,
 * a headset or a watch do not touch ExoPlayer: they go to Dart through [onCommand], and Dart
 * decides (it may call play/pause/seek back through the host API, which drives ExoPlayer
 * directly). Previous/next are always advertised although ExoPlayer holds a single item.
 */
@OptIn(UnstableApi::class)
internal class WalkForwardingPlayer(
    player: Player,
    private val onCommand: (MediaCommand) -> Unit,
) : ForwardingPlayer(player) {
    private val wrappedListeners = mutableMapOf<Player.Listener, Player.Listener>()

    override fun getAvailableCommands(): Player.Commands = withWalkCommands(super.getAvailableCommands())

    override fun isCommandAvailable(command: Int): Boolean = command in WALK_COMMANDS || super.isCommandAvailable(command)

    override fun getSeekBackIncrement(): Long = SEEK_BACK_MS

    override fun play() = onCommand(MediaCommand(MediaCommandKind.PLAY))

    override fun pause() = onCommand(MediaCommand(MediaCommandKind.PAUSE))

    override fun setPlayWhenReady(playWhenReady: Boolean) =
        onCommand(MediaCommand(if (playWhenReady) MediaCommandKind.PLAY else MediaCommandKind.PAUSE))

    /** The session prepares an idle player before `play`; Dart owns loading, so this is a no-op. */
    override fun prepare() = Unit

    override fun stop() = onCommand(MediaCommand(MediaCommandKind.STOP))

    override fun seekToNext() = onCommand(MediaCommand(MediaCommandKind.NEXT))

    override fun seekToNextMediaItem() = onCommand(MediaCommand(MediaCommandKind.NEXT))

    override fun seekToPrevious() = onCommand(MediaCommand(MediaCommandKind.PREVIOUS))

    override fun seekToPreviousMediaItem() = onCommand(MediaCommand(MediaCommandKind.PREVIOUS))

    override fun seekBack() = onCommand(MediaCommand(MediaCommandKind.SEEK_BY, -SEEK_BACK_MS))

    override fun seekForward() = onCommand(MediaCommand(MediaCommandKind.SEEK_BY, seekForwardIncrement))

    override fun seekTo(positionMs: Long) = onCommand(MediaCommand(MediaCommandKind.SEEK_TO, positionMs))

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) =
        onCommand(MediaCommand(MediaCommandKind.SEEK_TO, positionMs))

    /** Sent by the session when replaying an ended item; Dart decides what replay means. */
    override fun seekToDefaultPosition() = Unit

    override fun seekToDefaultPosition(mediaItemIndex: Int) = Unit

    /**
     * ExoPlayer reports its own available commands in `onAvailableCommandsChanged`, and the
     * session uses that argument, so listeners get the commands with previous/next added.
     */
    override fun addListener(listener: Player.Listener) {
        val wrapper = synchronized(wrappedListeners) {
            wrappedListeners.getOrPut(listener) { CommandsListener(listener) }
        }
        super.addListener(wrapper)
    }

    override fun removeListener(listener: Player.Listener) {
        val wrapper = synchronized(wrappedListeners) { wrappedListeners.remove(listener) } ?: return
        super.removeListener(wrapper)
    }

    private inner class CommandsListener(private val delegate: Player.Listener) : Player.Listener by delegate {
        override fun onAvailableCommandsChanged(availableCommands: Player.Commands) =
            delegate.onAvailableCommandsChanged(withWalkCommands(availableCommands))
    }

    companion object {
        const val SEEK_BACK_MS = 15_000L

        val WALK_COMMANDS = setOf(
            Player.COMMAND_PLAY_PAUSE,
            Player.COMMAND_SEEK_TO_NEXT,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_BACK,
            Player.COMMAND_STOP,
        )

        fun withWalkCommands(commands: Player.Commands): Player.Commands =
            commands.buildUpon().addAll(*WALK_COMMANDS.toIntArray()).build()
    }
}
