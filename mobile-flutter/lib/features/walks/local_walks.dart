import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../walk_engine/walk_view.dart';

/// A walk kept only on this device (site `local-store.ts`, `LocalWalkItem`).
@immutable
class LocalWalk {
  const LocalWalk({required this.document, required this.revision, this.updatedAt});
  final WalkDocument document;

  /// Starts at 0 and grows by one with every save.
  final int revision;
  final DateTime? updatedAt;

  String get id => document.id;
}

/// Device storage of guest walks. The walk builder owns the implementation; the walk screens only
/// read walks and save car copies. Every method throws a [FormatException] or [StateError] with a
/// Russian message when the storage is damaged or a concurrent edit is detected; nothing is lost.
abstract interface class LocalWalkStore {
  /// All walks on the device, in no particular order.
  Future<List<LocalWalk>> list();

  /// The walk with [id], or null when there is none.
  Future<LocalWalk?> get(String id);

  /// Saves [document]. [expectedRevision] is null for a new walk, otherwise the revision the caller
  /// edited; a different stored revision is a conflict.
  Future<LocalWalk> save(WalkDocument document, {int? expectedRevision});
}

/// Overridden by the app with the builder's store (see the walk builder feature).
final localWalkStoreProvider = Provider<LocalWalkStore>((ref) => throw UnimplementedError('localWalkStoreProvider'));
