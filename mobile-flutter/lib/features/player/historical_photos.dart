import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';

/// One archive photo of a stop (site `historical-photos.ts`).
@immutable
class HistoricalWalkPhoto {
  const HistoricalWalkPhoto(this.cid, this.year, this.title, String file) : src = 'https://img.pastvu.com/d/$file';

  /// The PastVu photo id: `https://pastvu.com/p/<cid>`.
  final int cid;

  /// A year or a range («1866–1870»).
  final String year;
  final String title;
  final String src;

  Uri get page => Uri.parse('https://pastvu.com/p/$cid');
}

const _pushkinSquare = [
  HistoricalWalkPhoto(1344568, '1901', 'Контора Международного общества спальных вагонов на Страстном бульваре', 'f/y/1/fy14mal6i5hhuvqjx2.jpg'),
  HistoricalWalkPhoto(681249, '1934', 'Церковь Дмитрия Солунского', 'w/s/n/wsnohkuzq2qpqaw7f8.jpg'),
  HistoricalWalkPhoto(1036442, '1968', 'Пушкинская площадь', 'v/z/v/vzvaspu7b7j2181xzy.jpg'),
];

const _prechistenskieGates = [
  HistoricalWalkPhoto(1005773, '1900', 'Храм Христа Спасителя', 'w/y/p/wyp2d0j53c3wfdmu6y.jpg'),
  HistoricalWalkPhoto(645200, '1910', 'Московский трамвай у Пречистенских ворот', '4/y/j/4yjqx5famhhg89mlus.jpg'),
  HistoricalWalkPhoto(87222, '1968', 'Метростроевская улица', 'd/a/6/da6f21b789c2497c008841a7f197c411.jpg'),
];

const _nationalHotel = [
  HistoricalWalkPhoto(1119022, '1930', 'Швейцар возле гостиницы «Националь»', '1/h/z/1hzg4jhitwxqmlv5aq.jpg'),
  HistoricalWalkPhoto(7141, '1935', 'Гостиница «Националь»', '8/1/c/81cb1527513bc30fd5913e3f9ab35072.jpg'),
  HistoricalWalkPhoto(4328, '1937', 'Гостиница «Националь»', 'a/8/a/a8ad9a7afa5cf86b8fab7667db974e50.jpg'),
];

const _centralTelegraph = [
  HistoricalWalkPhoto(1370355, '1926', 'Строительство Центрального телеграфа', '9/k/1/9k1we9k1s4c9a0vahb.png'),
  HistoricalWalkPhoto(988748, '1929', 'Центральный телеграф: трубы пневматической почты', 'd/n/z/dnzfvj4nw3jl4ntdyr.jpg'),
  HistoricalWalkPhoto(456294, '1953', 'Центральный Московский телеграф', 'w/4/t/w4thgk52w88qzia87g.png'),
];

const _nirnseeHouse = [
  HistoricalWalkPhoto(230, '1915', 'Панорама с дома Нирнзее', '5/7/1/571e01127e0499118ca9ec5ff0de69e6.jpg'),
  HistoricalWalkPhoto(19906, '1926', 'Ресторан «Крыша» на доме Нирнзее', '5/6/f/56f4b0676a9acfbb3de708ca0d192958.jpg'),
  HistoricalWalkPhoto(87944, '1951', 'На крыше дома Нирнзее', 'a/a/f/aaf1d800210a659d5d2b840e85ee95c1.jpg'),
];

const _lenkom = [
  HistoricalWalkPhoto(154120, '1910', 'Купеческое собрание: зрительный зал и сцена', 'b/3/g/b3gsbokqdmr0usdoci.jpg'),
  HistoricalWalkPhoto(69091, '1914', 'Лазарет в театре Купеческого клуба', 'b/1/9/b19f44322be7bc1fc8e97e50c5497919.jpg'),
  HistoricalWalkPhoto(2605780, '1948', 'Возле Театра имени Ленинского комсомола', 'q/y/k/qykogqzoxpeyq3vmhk.jpg'),
];

const _redSquare = [
  HistoricalWalkPhoto(77852, '1852', 'Старые Верхние торговые ряды за памятником Минину и Пожарскому', '2/e/e/2eeb7f006ba9021132c6868cab261419.jpg'),
  HistoricalWalkPhoto(47826, '1866–1870', 'Памятник Минину и Пожарскому перед прежними Верхними торговыми рядами', 'e/4/a/e4a5a311bee1ae8cb1129995eba69c78.jpg'),
  HistoricalWalkPhoto(70775, '1890–1905', 'Торговые палатки на Красной площади', '8/9/a/89a3ca71f36194ebf06216863b7be151.jpg'),
];

/// Photos of published walks by «walk id:stop id»: stop ids repeat between walks
/// (`tverskaya-stop-1` is Pushkin Square in one walk and the «Националь» in another).
const Map<String, List<HistoricalWalkPhoto>> historicalWalkPhotoTable = {
  '956c756d-452f-59c9-a3a5-d935a3e90764:red-square-stop-4': _redSquare,
  '5295c72b-5d9f-4142-9d26-fb4f367b8865:boulevard-stop-1': _prechistenskieGates,
  '0055eb13-d26d-4eab-b1f6-b25900bd7095:tverskaya-stop-1': _pushkinSquare,
  '259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-10': _pushkinSquare,
  '259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-1': _nationalHotel,
  '259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-3': _centralTelegraph,
  '259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-9': _nirnseeHouse,
  '259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-12': _lenkom,
};

List<HistoricalWalkPhoto> historicalWalkPhotos(String walkId, String stopId) =>
    historicalWalkPhotoTable['$walkId:$stopId'] ?? const [];

/// «Исторические снимки · N» in the walk tools; nothing for a stop without photos.
class HistoricalPhotosButton extends StatelessWidget {
  const HistoricalPhotosButton({super.key, required this.walkId, required this.stopId});

  final String walkId;
  final String stopId;

  @override
  Widget build(BuildContext context) {
    final photos = historicalWalkPhotos(walkId, stopId);
    if (photos.isEmpty) return const SizedBox.shrink();
    return OutlinedButton.icon(
      icon: const Icon(Icons.photo_library_outlined),
      onPressed: () => showDialog<void>(
        context: context,
        builder: (context) => HistoricalPhotosViewer(photos: photos),
      ),
      label: Text(context.t('Исторические снимки · {count}', {'count': photos.length})),
    );
  }
}

/// One photo at a time with its year and title, arrows between photos and the PastVu link.
class HistoricalPhotosViewer extends StatefulWidget {
  const HistoricalPhotosViewer({super.key, required this.photos});

  final List<HistoricalWalkPhoto> photos;

  @override
  State<HistoricalPhotosViewer> createState() => _HistoricalPhotosViewerState();
}

class _HistoricalPhotosViewerState extends State<HistoricalPhotosViewer> {
  int _index = 0;
  int _attempt = 0;
  bool _linkFailed = false;

  void _change(int step) => setState(() {
        _index = (_index + step).clamp(0, widget.photos.length - 1);
        _attempt = 0;
        _linkFailed = false;
      });

  Future<void> _open(Uri page) async {
    bool opened;
    try {
      opened = await launchUrl(page, mode: LaunchMode.externalApplication);
    } on Object {
      opened = false;
    }
    if (!opened && mounted) setState(() => _linkFailed = true);
  }

  @override
  Widget build(BuildContext context) {
    final photos = widget.photos;
    final photo = photos[_index];
    final theme = Theme.of(context);
    return Dialog.fullscreen(
      backgroundColor: TokenColors.ink,
      child: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(TokenSizes.spaceMd),
                child: Semantics(
                  header: true,
                  child: Text('${photo.year} · ${photo.title}', style: theme.textTheme.titleMedium?.copyWith(color: TokenColors.onDark)),
                ),
              ),
            ),
            IconButton(
              tooltip: context.t('Закрыть фото'),
              color: TokenColors.onDark,
              icon: const Icon(Icons.close),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ]),
          Expanded(
            child: Stack(alignment: Alignment.center, children: [
              Positioned.fill(
                child: Image.network(
                  photo.src,
                  key: ValueKey('${photo.cid}:$_attempt'),
                  fit: BoxFit.contain,
                  semanticLabel: context.t('{title}, {year} год', {'title': photo.title, 'year': photo.year}),
                  loadingBuilder: (context, child, progress) =>
                      progress == null ? child : const Center(child: CircularProgressIndicator(color: TokenColors.onDark)),
                  errorBuilder: (context, error, stack) => Center(
                    child: Semantics(
                      liveRegion: true,
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Padding(
                          padding: const EdgeInsets.all(TokenSizes.spaceMd),
                          child: Text(
                            context.t('Фотография не загрузилась. Проверьте подключение и попробуйте ещё раз.'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: TokenColors.onDark),
                          ),
                        ),
                        FilledButton(onPressed: () => setState(() => _attempt += 1), child: Text(context.t('Повторить'))),
                      ]),
                    ),
                  ),
                ),
              ),
              if (photos.length > 1) ...[
                Positioned(
                  left: TokenSizes.spaceXs,
                  child: IconButton.filledTonal(
                    tooltip: context.t('Предыдущее фото'),
                    onPressed: _index == 0 ? null : () => _change(-1),
                    icon: const Icon(Icons.chevron_left),
                  ),
                ),
                Positioned(
                  right: TokenSizes.spaceXs,
                  child: IconButton.filledTonal(
                    tooltip: context.t('Следующее фото'),
                    onPressed: _index == photos.length - 1 ? null : () => _change(1),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ),
                Positioned(
                  bottom: TokenSizes.spaceXs,
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      context.t('Фото {current} из {total}', {'current': _index + 1, 'total': photos.length}),
                      style: const TextStyle(color: TokenColors.onDark),
                    ),
                  ),
                ),
              ],
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(TokenSizes.spaceXs),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextButton(
                style: TextButton.styleFrom(foregroundColor: TokenColors.onDark),
                onPressed: () => _open(photo.page),
                child: Text(context.t('Открыть на PastVu')),
              ),
              if (_linkFailed)
                Semantics(
                  liveRegion: true,
                  child: Text(context.t('Не удалось открыть ссылку.'), style: const TextStyle(color: TokenColors.onDark)),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}
