import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';

const _minSize = Size(TokenSizes.controlPrimaryMin, TokenSizes.controlPrimaryMin);

/// A group of builder controls with even spacing.
class Section extends StatelessWidget {
  const Section({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var index = 0; index < children.length; index++) ...[
              if (index > 0) const SizedBox(height: 8),
              children[index],
            ],
          ],
        ),
      );
}

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => FilledButton(
        style: FilledButton.styleFrom(minimumSize: _minSize),
        onPressed: onPressed,
        child: Text(label, textAlign: TextAlign.center),
      );
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => OutlinedButton(
        style: OutlinedButton.styleFrom(minimumSize: _minSize),
        onPressed: onPressed,
        child: Text(label, textAlign: TextAlign.center),
      );
}

/// A status line, or an alert when [alert]; [action] is a button inside it.
class Notice extends StatelessWidget {
  const Notice({super.key, required this.text, this.alert = false, this.action});

  final String text;
  final bool alert;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: alert ? TokenColors.alertSurface : TokenColors.noticeSurface,
            borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(text, style: TextStyle(color: alert ? TokenColors.alertInk : TokenColors.ink)),
              ?action,
            ]),
          ),
        ),
      );
}
