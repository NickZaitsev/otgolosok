import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';

// Placeholder until the feature screen lands.
class MyWalksScreen extends StatelessWidget {
  const MyWalksScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(context.t('Мои прогулки'))));
}
