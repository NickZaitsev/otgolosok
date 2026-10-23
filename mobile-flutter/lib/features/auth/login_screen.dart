import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';

// Placeholder until the feature screen lands.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key, this.returnTo});
  final String? returnTo;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(context.t('Вход'))));
}
