import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/checkpoint.dart';

/// «1,25×» in the interface language (the site's `rate.toLocaleString(languageTag)`).
String rateLabel(double rate, AppLocale locale) {
  final text = rate == rate.roundToDouble() ? rate.toInt().toString() : rate.toString();
  return '${locale == AppLocale.ru ? text.replaceAll('.', ',') : text}×';
}

/// The site's compact walk player (`AudioPlayerControls compact walk`): the timeline with times,
/// the speed button, 15 s back, play/pause with its label and 15 s forward. [mini] keeps only the
/// toggle, the timeline and 15 s back, for the footer while a drawer covers the player.
class AudioControls extends StatelessWidget {
  const AudioControls({
    super.key,
    required this.position,
    required this.duration,
    required this.canSeek,
    required this.playing,
    required this.label,
    required this.onToggle,
    required this.onSeek,
    this.caption,
    this.rate,
    this.onRate,
    this.mini = false,
  });

  /// Seconds.
  final double position;
  final double duration;
  final bool canSeek;
  final bool playing;

  /// The toggle's spoken label (already translated).
  final String label;

  /// A shorter visible text for the toggle (already translated).
  final String? caption;
  final VoidCallback onToggle;
  final ValueChanged<double> onSeek;
  final double? rate;
  final VoidCallback? onRate;
  final bool mini;

  @override
  Widget build(BuildContext context) {
    final maximum = duration.isFinite && duration > 0 ? duration : 0.0;
    final current = position.isFinite ? position.clamp(0.0, maximum) : 0.0;
    final seekable = canSeek && maximum > 0;
    final timeline = Column(mainAxisSize: MainAxisSize.min, children: [
      Semantics(
        label: context.t('Позиция воспроизведения'),
        value: context.t('{current} из {duration}', {'current': formatPlaybackTime(current), 'duration': formatPlaybackTime(maximum)}),
        child: Slider(
          value: maximum > 0 ? current : 0,
          max: maximum > 0 ? maximum : 1,
          onChanged: seekable ? onSeek : null,
        ),
      ),
      ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: TokenSizes.spaceMd),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(formatPlaybackTime(current), style: Theme.of(context).textTheme.bodySmall),
            Text(formatPlaybackTime(maximum), style: Theme.of(context).textTheme.bodySmall),
          ]),
        ),
      ),
    ]);
    final back = IconButton(
      tooltip: context.t('Назад на 15 секунд'),
      icon: const _SkipIcon(forward: false),
      onPressed: seekable && current > 0 ? () => onSeek((current - 15).clamp(0.0, maximum)) : null,
    );
    final toggleIcon = Icon(playing ? Icons.pause : Icons.play_arrow);
    if (mini) {
      return Semantics(
        container: true,
        label: context.t('Плеер истории'),
        child: Row(children: [
          IconButton.filled(tooltip: label, onPressed: onToggle, icon: toggleIcon),
          Expanded(child: timeline),
          back,
        ]),
      );
    }
    final rateValue = rate;
    return Semantics(
      container: true,
      label: context.t('Плеер истории'),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        timeline,
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          if (rateValue != null && onRate != null)
            Semantics(
              button: true,
              label: context.t('Скорость рассказа: {rate}', {'rate': rateLabel(rateValue, context.appLocale)}),
              excludeSemantics: true,
              child: TextButton(onPressed: onRate, child: Text(rateLabel(rateValue, context.appLocale))),
            ),
          back,
          Flexible(
            child: Semantics(
              button: true,
              label: label,
              excludeSemantics: true,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(minimumSize: const Size(0, TokenSizes.controlPrimaryMin)),
                onPressed: onToggle,
                icon: toggleIcon,
                label: Text(caption ?? label, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ),
          ),
          IconButton(
            tooltip: context.t('Вперёд на 15 секунд'),
            icon: const _SkipIcon(forward: true),
            onPressed: seekable && current < maximum ? () => onSeek((current + 15).clamp(0.0, maximum)) : null,
          ),
        ]),
      ]),
    );
  }
}

/// A circular arrow with the 15-second step inside, mirrored for the forward skip.
class _SkipIcon extends StatelessWidget {
  const _SkipIcon({required this.forward});

  final bool forward;

  @override
  Widget build(BuildContext context) {
    final color = IconTheme.of(context).color;
    return SizedBox.square(
      dimension: 30,
      child: Stack(alignment: Alignment.center, children: [
        Transform.flip(flipX: forward, child: const Icon(Icons.replay, size: 30)),
        Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Text('15', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: color)),
        ),
      ]),
    );
  }
}
