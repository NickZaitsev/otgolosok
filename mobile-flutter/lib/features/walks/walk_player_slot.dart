import 'package:flutter/material.dart';

import '../../walk_engine/walk_view.dart';
import '../player/walk_player_panel.dart';
import 'walk_link.dart';

/// Where the player sits on the walk screen.
class WalkPlayerSlot extends StatelessWidget {
  const WalkPlayerSlot({super.key, required this.view, required this.link, required this.localAudio, this.intro});
  final WalkView view;
  final WalkLink link;

  /// Saved recordings by their site-relative URL (the player also accepts chapter ids).
  final Map<String, Uri> localAudio;

  /// The walk's summary and tools, shown under the map before the start.
  final Widget? intro;

  @override
  Widget build(BuildContext context) => WalkPlayerPanel(view: view, link: link, localAudio: localAudio, intro: intro);
}
