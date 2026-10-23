import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';

// Placeholder until the feature screen lands.
class ExploreScreen extends StatelessWidget {
  const ExploreScreen({super.key, this.placeId});
  final String? placeId;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(context.t('Рядом'))));
}
