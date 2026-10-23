/// «Поделиться» for a catalog place (port of `share-place.ts` / `share-place-button.tsx`).
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/links/app_links.dart';

/// The shared link `https://origin/place/<type>/<number>` carries a preview with the title and the photo;
/// en/zh add `?lang=`.
Uri placeShareUrl(Uri origin, String placeId, AppLocale locale) =>
    Uri.parse('$origin${placeSharePath(placeId, locale: locale.name)}');

/// How sharing ended: the system sheet took it, the user closed it, the link was copied, or it must be copied by hand.
enum ShareOutcome { shared, cancelled, copied, manual }

typedef ShareSheet = Future<ShareResultStatus> Function(ShareParams params);
typedef CopyText = Future<void> Function(String text);

Future<ShareResultStatus> _systemShare(ShareParams params) async => (await SharePlus.instance.share(params)).status;
Future<void> _copy(String text) => Clipboard.setData(ClipboardData(text: text));

/// The system share sheet; when it is unavailable or fails, the link goes to the clipboard.
Future<ShareOutcome> sharePlace({
  required String title,
  required Uri url,
  required String text,
  required String dialogTitle,
  ShareSheet share = _systemShare,
  CopyText copy = _copy,
}) async {
  try {
    final status = await share(ShareParams(text: '$text $url', subject: title, title: dialogTitle));
    if (status == ShareResultStatus.success) return ShareOutcome.shared;
    if (status == ShareResultStatus.dismissed) return ShareOutcome.cancelled;
  } on Object catch (error) {
    debugPrint('Share sheet failed: $error');
  }
  try {
    await copy(url.toString());
    return ShareOutcome.copied;
  } on Object catch (error) {
    debugPrint('Clipboard failed: $error');
    return ShareOutcome.manual;
  }
}

/// Key it by the place so the result of sharing never outlives its place.
class PlaceShareButton extends ConsumerStatefulWidget {
  const PlaceShareButton({super.key, required this.placeId, required this.title});

  final String placeId;
  final String title;

  @override
  ConsumerState<PlaceShareButton> createState() => _PlaceShareButtonState();
}

class _PlaceShareButtonState extends ConsumerState<PlaceShareButton> {
  var _busy = false;
  ShareOutcome? _outcome;
  Uri? _url;

  Future<void> _share() async {
    // The share sheet is open: a second tap must not stack another one.
    if (_busy) return;
    final locale = context.appLocale;
    final url = placeShareUrl(ref.read(configProvider).origin, widget.placeId, locale);
    final text = context.t('{title} — история в «Отголоске»', {'title': widget.title});
    final dialogTitle = context.t('Поделиться');
    setState(() {
      _busy = true;
      _outcome = null;
      _url = url;
    });
    final outcome = await sharePlace(title: widget.title, url: url, text: text, dialogTitle: dialogTitle);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _outcome = outcome;
    });
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          OutlinedButton.icon(
            onPressed: _busy ? null : _share,
            icon: const Icon(Icons.share_outlined),
            label: Text(context.t('Поделиться')),
          ),
          if (_outcome == ShareOutcome.copied)
            Padding(
              padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
              child: Semantics(liveRegion: true, child: Text(context.t('Ссылка скопирована.'))),
            ),
          if (_outcome == ShareOutcome.manual && _url != null)
            Padding(
              padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
              child: SelectableText.rich(TextSpan(children: [
                TextSpan(text: '${context.t('Скопируйте ссылку')}\n'),
                TextSpan(text: _url.toString()),
              ])),
            ),
        ],
      );
}
