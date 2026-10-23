import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';

/// An announced error with an optional retry, like the site's `role="alert"` notices.
class AlertNotice extends StatelessWidget {
  const AlertNotice({super.key, required this.text, this.onRetry, this.retryLabel = 'Повторить'});

  final String text;
  final VoidCallback? onRetry;

  /// Russian source of the retry button label.
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(color: TokenColors.alertSurface, borderRadius: BorderRadius.circular(TokenSizes.radiusSm)),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: TokenSizes.spaceSm, vertical: TokenSizes.spaceXs),
          child: Row(children: [
            Expanded(child: Text(text, style: const TextStyle(color: TokenColors.alertInk))),
            if (onRetry != null) TextButton(onPressed: onRetry, child: Text(context.t(retryLabel))),
          ]),
        ),
      ),
    );
  }
}

/// A polite status line (notices such as «Имя сохранено.»).
class StatusNotice extends StatelessWidget {
  const StatusNotice({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(color: TokenColors.noticeSurface, borderRadius: BorderRadius.circular(TokenSizes.radiusSm)),
        child: Padding(padding: const EdgeInsets.all(TokenSizes.spaceSm), child: Text(text)),
      ),
    );
  }
}

/// A centred progress indicator with a status text.
class LoadingStatus extends StatelessWidget {
  const LoadingStatus({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceLg),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: TokenSizes.spaceSm),
          Flexible(child: Text(text)),
        ]),
      ),
    );
  }
}
