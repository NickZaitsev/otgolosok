import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/tokens.g.dart';
import 'top_model.dart';

/// OSM's tile policy rejects generic HTTP-library user agents; the app names itself.
const osmTileHeaders = {'User-Agent': 'Otgolosok/1.0 (+https://otgolosok.online)'};

/// The route sketch of a top card (site `RoutePreview`): OSM tiles under the route when the server
/// sent a map frame; one retry of the tiles, then the plain sketch.
class RoutePreview extends StatefulWidget {
  const RoutePreview({super.key, required this.walk, this.size = 104});
  final TopWalk walk;
  final double size;

  @override
  State<RoutePreview> createState() => _RoutePreviewState();
}

class _RoutePreviewState extends State<RoutePreview> {
  int _attempt = 0;
  bool _mapFailed = false;
  bool _retrying = false;

  void _tileFailed() {
    if (_retrying || _mapFailed || !mounted) return;
    if (_attempt >= 1) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _mapFailed = true);
      });
      return;
    }
    _retrying = true;
    Future<void>.delayed(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _attempt++;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final map = _mapFailed ? null : widget.walk.mapPreview;
    final points = map?.points ?? widget.walk.preview;
    final frame = map == null ? 100.0 : 256.0;
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
        child: SizedBox.square(
          dimension: widget.size,
          child: ColoredBox(
            color: TokenColors.sunken,
            child: points == null
                ? const Center(child: Text('↗', style: TextStyle(fontSize: 28, color: TokenColors.mapGreen)))
                : FittedBox(
                    fit: map == null ? BoxFit.contain : BoxFit.cover,
                    child: SizedBox.square(
                      dimension: frame,
                      child: Stack(clipBehavior: Clip.hardEdge, children: [
                        if (map != null)
                          for (final tile in map.tiles)
                            Positioned(
                              left: tile.left,
                              top: tile.top,
                              width: 256,
                              height: 256,
                              child: Image.network(
                                'https://tile.openstreetmap.org/${map.zoom}/${tile.x}/${tile.y}.png',
                                key: ValueKey('$_attempt-${tile.x}-${tile.y}'),
                                headers: osmTileHeaders,
                                errorBuilder: (context, error, stack) {
                                  _tileFailed();
                                  return const SizedBox.shrink();
                                },
                              ),
                            ),
                        Positioned.fill(child: CustomPaint(painter: _RoutePainter(points, map != null))),
                      ]),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  _RoutePainter(this.points, this.onMap);
  final List<(double, double)> points;
  final bool onMap;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()..moveTo(points.first.$1, points.first.$2);
    for (final (x, y) in points.skip(1)) {
      path.lineTo(x, y);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = TokenColors.routeLine
        ..style = PaintingStyle.stroke
        ..strokeWidth = onMap ? 6 : 3
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
    final radius = onMap ? 9.0 : 5.0;
    canvas.drawCircle(Offset(points.first.$1, points.first.$2), radius, Paint()..color = TokenColors.mapGreen);
    canvas.drawCircle(Offset(points.last.$1, points.last.$2), radius, Paint()..color = TokenColors.mapOrange);
  }

  @override
  bool shouldRepaint(_RoutePainter old) => old.points != points || old.onMap != onMap;
}

/// «© OpenStreetMap» under a map preview, linking to the copyright page.
class OsmAttribution extends StatelessWidget {
  const OsmAttribution({super.key});

  @override
  Widget build(BuildContext context) => TextButton(
        style: TextButton.styleFrom(minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: 4)),
        onPressed: () => launchUrl(Uri.parse('https://www.openstreetmap.org/copyright'), mode: LaunchMode.externalApplication),
        child: const Text('© OpenStreetMap', style: TextStyle(fontSize: TokenSizes.textMeta, fontWeight: FontWeight.w400)),
      );
}
