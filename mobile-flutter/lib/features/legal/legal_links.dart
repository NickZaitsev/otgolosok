import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../core/i18n/i18n.dart';

/// Legal documents published by the site at `/legal/<slug>` (src/lib/legal/document-content.tsx).
/// The app never copies their text: it opens the site page, the single source of truth.
enum LegalDocument {
  terms('terms'),
  privacy('privacy'),
  cookies('cookies');

  const LegalDocument(this.slug);

  final String slug;

  String get path => '/legal/$slug';
}

/// Opens [url] in a Custom Tab (or, when [external], in the app that handles it, such as Telegram),
/// falling back to the browser; shows a message when nothing can open it.
Future<void> openUrl(BuildContext context, Uri url, {bool external = false}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final failed = context.t('Не удалось открыть страницу.');
  for (final mode in [if (!external) LaunchMode.inAppBrowserView, LaunchMode.externalApplication]) {
    try {
      if (await launchUrl(url, mode: mode)) return;
    } on PlatformException catch (error) {
      debugPrint('open ${url.path}: ${error.code}');
    }
  }
  messenger?.showSnackBar(SnackBar(content: Text(failed)));
}

Future<void> openLegalDocument(BuildContext context, WidgetRef ref, LegalDocument document) =>
    openUrl(context, ref.read(configProvider).siteUrl(document.path));

/// The legal footer of the site's `LegalLinks`, without the cookie settings: the app sets no
/// analytics or advertising cookies, so it has nothing to consent to.
class LegalLinks extends ConsumerWidget {
  const LegalLinks({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final labels = {
      LegalDocument.terms: context.t('Условия использования'),
      LegalDocument.privacy: context.t('Политика обработки данных'),
      LegalDocument.cookies: context.t('О cookie'),
    };
    return Semantics(
      container: true,
      label: context.t('Правовая информация'),
      child: Wrap(
        spacing: 4,
        children: [
          for (final MapEntry(key: document, value: label) in labels.entries)
            TextButton(
              onPressed: () => openLegalDocument(context, ref, document),
              style: TextButton.styleFrom(textStyle: Theme.of(context).textTheme.labelMedium),
              child: Text(label),
            ),
        ],
      ),
    );
  }
}
