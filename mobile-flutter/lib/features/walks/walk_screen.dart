import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';
import 'walk_link.dart';

// Placeholder until the feature screen lands.
class WalkScreen extends StatelessWidget {
  const WalkScreen({super.key, required this.link});

  final WalkLink link;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(context.t('Прогулка'))));
}
