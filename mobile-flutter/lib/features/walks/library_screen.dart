import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';

// Placeholder until the feature screen lands.
class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key, this.tab});
  final String? tab;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(context.t('История'))));
}
