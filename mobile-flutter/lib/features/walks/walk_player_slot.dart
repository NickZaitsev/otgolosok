import 'package:flutter/material.dart';

import '../../walk_engine/walk_view.dart';
import '../player/walk_player_panel.dart';
import 'walk_link.dart';

/// Where the player sits on the walk screen.
class WalkPlayerSlot extends StatelessWidget {
  const WalkPlayerSlot({super.key, required this.view, required this.link, required this.localAudio, this.intro, this.mount, this.onAddFood});
  final WalkView view;
  final WalkLink link;

  /// Saved recordings by their site-relative URL (the player also accepts chapter ids).
  final Map<String, Uri> localAudio;

  /// The walk's summary and tools, shown under the map before the start.
  final Widget? intro;

  /// The load the walk came from; the player keeps running while it stays the same.
  final String? mount;

  /// Adds a food place to the walk; null where places cannot join it.
  final AddFood? onAddFood;

  @override
  Widget build(BuildContext context) => WalkPlayerPanel(view: view, link: link, localAudio: localAudio, intro: intro, mount: mount, onAddFood: onAddFood);
}
