/// The photo on top of a place card and its full-screen viewer with the credit (port of `place-photo.tsx`).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import 'place_story.dart';

/// The tallest width-to-height ratio of the banner: a little taller than a square, so the text stays in sight.
const tallestPhotoRatio = 4 / 5;

/// An absolute image URL: our photos are origin-relative paths, Flickr ones are absolute already.
Uri placePhotoUrl(Uri origin, String src) => src.startsWith('/') ? origin.replace(path: src) : Uri.parse(src);

/// Who made the photo and where it comes from: «Отголосок» illustrations, Flickr or Wikimedia Commons.
({bool illustrated, String sourceName}) photoSource(PlacePhoto photo) {
  final host = Uri.tryParse(photo.sourceUrl)?.host ?? '';
  final illustrated = host == 'otgolosok.online';
  return (illustrated: illustrated, sourceName: illustrated ? 'Отголосок' : host == 'www.flickr.com' ? 'Flickr' : 'Wikimedia Commons');
}

String _caption(String text) => text.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();

/// Opens [url] outside the app; a failure is reported in a snack bar instead of disappearing.
Future<void> openExternalLink(BuildContext context, Uri url) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final message = context.t('Не удалось открыть ссылку.');
  var opened = false;
  try {
    opened = await launchUrl(url, mode: LaunchMode.externalApplication);
  } on Object catch (error) {
    debugPrint('Could not open $url: $error');
  }
  if (!opened) messenger?.showSnackBar(SnackBar(content: Text(message)));
}

/// The wide photo on top of a place card. [pending] holds an empty banner while the photo of a place known
/// to have one loads, so the card never jumps. Renders nothing without a photo or after the image fails.
/// With [onPreview] the banner only expands the card; otherwise a tap opens the viewer.
class PlacePhotoBanner extends ConsumerStatefulWidget {
  const PlacePhotoBanner({super.key, required this.photo, required this.title, this.pending = false, this.onPreview, this.maxHeight});

  final PlacePhoto? photo;
  final String title;
  final bool pending;
  final VoidCallback? onPreview;

  /// The peek card keeps the banner low; the expanded card shows it whole up to 4:5.
  final double? maxHeight;

  @override
  ConsumerState<PlacePhotoBanner> createState() => _PlacePhotoBannerState();
}

class _PlacePhotoBannerState extends ConsumerState<PlacePhotoBanner> {
  var _failed = false;

  @override
  void didUpdateWidget(PlacePhotoBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.photo?.src != widget.photo?.src) _failed = false;
  }

  @override
  Widget build(BuildContext context) {
    final photo = widget.photo;
    final placeholder = ColoredBox(color: Theme.of(context).colorScheme.surfaceContainerHigh);
    if (photo == null && widget.pending) {
      return ExcludeSemantics(child: SizedBox(height: widget.maxHeight ?? 160, width: double.infinity, child: placeholder));
    }
    if (photo == null || _failed) return const SizedBox.shrink();
    final origin = ref.watch(configProvider).origin;
    final ratio = (photo.width / photo.height).clamp(tallestPhotoRatio, double.infinity);
    final image = Image.network(
      placePhotoUrl(origin, photo.src).toString(),
      fit: BoxFit.cover,
      semanticLabel: photo.alt,
      frameBuilder: (context, child, frame, synchronous) => frame == null && !synchronous ? placeholder : child,
      errorBuilder: (context, error, stack) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _failed = true);
        });
        return placeholder;
      },
    );
    final framed = LayoutBuilder(builder: (context, constraints) {
      final height = constraints.maxWidth / ratio;
      return SizedBox(
        width: double.infinity,
        height: widget.maxHeight == null ? height : height.clamp(0, widget.maxHeight!),
        child: image,
      );
    });
    final preview = widget.onPreview;
    if (preview != null) return GestureDetector(onTap: preview, child: framed);
    return Semantics(
      button: true,
      label: context.t('Открыть фото: {title}', {'title': widget.title}),
      excludeSemantics: true,
      child: InkWell(
        onTap: () => showPlacePhotoViewer(context, photo: photo, title: widget.title, origin: origin),
        child: framed,
      ),
    );
  }
}

/// The full image with its caption and credit.
Future<void> showPlacePhotoViewer(BuildContext context, {required PlacePhoto photo, required String title, required Uri origin}) =>
    showDialog<void>(
      context: context,
      useSafeArea: false,
      builder: (context) => _PhotoViewer(photo: photo, title: title, origin: origin),
    );

class _PhotoViewer extends StatefulWidget {
  const _PhotoViewer({required this.photo, required this.title, required this.origin});

  final PlacePhoto photo;
  final String title;
  final Uri origin;

  @override
  State<_PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<_PhotoViewer> {
  var _attempt = 0;
  var _failed = false;

  @override
  Widget build(BuildContext context) {
    final photo = widget.photo;
    final theme = Theme.of(context);
    final source = photoSource(photo);
    final sameCaption = _caption(photo.alt) == _caption(widget.title);
    final linkStyle = theme.textTheme.bodyMedium?.copyWith(decoration: TextDecoration.underline);
    return Dialog.fullscreen(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceXs, 0),
              child: Row(children: [
                Expanded(child: Semantics(header: true, child: Text(widget.title, style: theme.textTheme.titleLarge))),
                IconButton(
                  tooltip: context.t('Закрыть фото'),
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ]),
            ),
            Expanded(
              child: _failed
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(TokenSizes.spaceLg),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              context.t('Фотография не загрузилась. Проверьте подключение и попробуйте ещё раз.'),
                              textAlign: TextAlign.center,
                            ),
                          ),
                          const SizedBox(height: TokenSizes.spaceSm),
                          FilledButton(
                            onPressed: () => setState(() {
                              _attempt++;
                              _failed = false;
                            }),
                            child: Text(context.t('Повторить')),
                          ),
                        ]),
                      ),
                    )
                  : InteractiveViewer(
                      maxScale: 5,
                      child: Center(
                        child: Image.network(
                          placePhotoUrl(widget.origin, photo.src).toString(),
                          key: ValueKey(_attempt),
                          fit: BoxFit.contain,
                          semanticLabel: photo.alt,
                          loadingBuilder: (context, child, progress) =>
                              progress == null ? child : const Center(child: CircularProgressIndicator()),
                          errorBuilder: (context, error, stack) {
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted) setState(() => _failed = true);
                            });
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(TokenSizes.spaceMd),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (!sameCaption) Text(photo.alt, style: theme.textTheme.bodyMedium),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('${context.t(source.illustrated ? 'Иллюстрация:' : 'Фото:')} ${photo.author == null ? '' : '${photo.author}. '}'),
                    _Link(label: source.sourceName, style: linkStyle, url: Uri.parse(photo.sourceUrl)),
                    const Text(' · '),
                    _Link(label: photo.license, style: linkStyle, url: Uri.parse(photo.licenseUrl)),
                  ],
                ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _Link extends StatelessWidget {
  const _Link({required this.label, required this.url, this.style});

  final String label;
  final Uri url;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => Semantics(
        link: true,
        child: InkWell(
          onTap: () => openExternalLink(context, url),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
            child: Align(widthFactor: 1, child: Text(label, style: style)),
          ),
        ),
      );
}
