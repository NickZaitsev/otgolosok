import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../walk_engine/distance.dart';

/// Food of one walk: about four cells of a few hundred kilobytes; a bigger copy is skipped, not the walk.
const offlineFoodMaxBytes = 4 * 1024 * 1024;

/// One saved food cell: `key` is `<lat>:<lon>` of the cell grid, [body] its raw JSON answer.
@immutable
class OfflineFoodCell {
  const OfflineFoodCell({required this.key, required this.etag, required this.body, required this.bytes});
  final String key;
  final String etag;
  final String body;

  /// UTF-8 size of [body]; checked again when the copy is opened.
  final int bytes;
}

/// Food cells along a route with their raw manifest (site `OfflineFoodBundle`).
@immutable
class OfflineFoodBundle {
  const OfflineFoodBundle({
    required this.manifestBody,
    required this.sourceEditedAt,
    required this.attribution,
    required this.cells,
  });

  /// The food manifest exactly as downloaded.
  final String manifestBody;
  final String sourceEditedAt;
  final String attribution;
  final List<OfflineFoodCell> cells;
}

/// The result of a food download: food is optional, so a failure is only a [warning] for the walker.
@immutable
class OfflineFoodDownload {
  const OfflineFoodDownload({required this.bundle, required this.warning});
  const OfflineFoodDownload.none() : bundle = null, warning = false;
  final OfflineFoodBundle? bundle;
  final bool warning;
}

/// Food cells for an offline copy (site `offline-food.ts`). The places/explore feature that owns
/// the food cell store implements it; without one, offline copies are saved without food.
abstract interface class OfflineFoodSource {
  /// Downloads the cells the route passes within [maxBytes]; never throws: a failure is a warning.
  Future<OfflineFoodDownload> download(List<GeoPoint> geometry, int maxBytes);

  /// Puts the saved cells into the live store; a newer live manifest must win over an old copy.
  void seed(OfflineFoodBundle bundle);
}

/// Overridden by the feature that owns the food cells; `null` saves copies without food.
final offlineFoodSourceProvider = Provider<OfflineFoodSource?>((ref) => null);
