import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import 'top_model.dart';

Color hexColor(String hex) => Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));

/// Filled dots for a station's lines; a zone draws its line as a ring.
class LineDots extends StatelessWidget {
  const LineDots({super.key, required this.lines, this.zone = false});
  final List<MetroLine> lines;
  final bool zone;

  @override
  Widget build(BuildContext context) {
    Widget dot(Color? color, {String? tooltip}) {
      final box = Container(
        width: 12,
        height: 12,
        margin: const EdgeInsets.only(right: 3),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: zone ? null : color ?? TokenColors.controlBorder,
          border: zone ? Border.all(color: color ?? TokenColors.controlBorder, width: 3) : null,
        ),
      );
      return tooltip == null ? box : Tooltip(message: tooltip, child: box);
    }

    return ExcludeSemantics(
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (lines.isEmpty) dot(null) else for (final line in lines) dot(hexColor(line.color), tooltip: line.name),
      ]),
    );
  }
}

/// Station picker for the metro filters (site `metro-select.tsx`): the field opens a sheet with a
/// search over the stations; the first option resets the filter, search ignores case and ё and also
/// matches line names.
class MetroSelect extends StatelessWidget {
  const MetroSelect({super.key, required this.label, required this.value, required this.options, required this.onChanged});

  final String label;
  final String value;
  final List<MetroOption> options;
  final ValueChanged<String> onChanged;

  MetroOption? get _selected => options.where((option) => option.name == value).firstOrNull ?? (value.isEmpty ? null : MetroOption(name: value, lines: const []));

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
        onTap: () => _open(context),
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.arrow_drop_down)),
          child: Row(children: [
            if (selected != null) LineDots(lines: selected.lines, zone: selected.isZone),
            Expanded(
              child: Text(
                selected == null ? context.t('Любая станция') : selected.label ?? selected.name,
                overflow: TextOverflow.ellipsis,
                style: selected == null ? const TextStyle(color: TokenColors.muted) : null,
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context) async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _MetroSheet(label: label, value: value, options: options),
    );
    if (chosen != null && chosen != value) onChanged(chosen);
  }
}

class _MetroSheet extends StatefulWidget {
  const _MetroSheet({required this.label, required this.value, required this.options});
  final String label;
  final String value;
  final List<MetroOption> options;

  @override
  State<_MetroSheet> createState() => _MetroSheetState();
}

class _MetroSheetState extends State<_MetroSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final matches = searchMetroOptions(widget.options, _query);
    // «Any station» stays first while the field is empty and drops out of a search.
    final items = <MetroOption?>[if (_query.trim().isEmpty) null, ...matches];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              autofocus: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: InputDecoration(
                hintText: context.t('Найти станцию или линию'),
                labelText: context.t('Поиск: {label}', {'label': widget.label}),
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
          ),
          Expanded(
            child: items.isEmpty
                ? Center(child: Text(context.t('Станция не найдена')))
                : ListView.builder(
                    itemCount: items.length,
                    itemBuilder: (context, index) {
                      final option = items[index];
                      final name = option?.name ?? '';
                      return ListTile(
                        minTileHeight: 48,
                        selected: name == widget.value,
                        leading: option == null ? null : LineDots(lines: option.lines, zone: option.isZone),
                        title: Text(option == null ? context.t('Любая станция') : option.label ?? option.name),
                        subtitle: option == null || (option.hint == null && option.lines.isEmpty)
                            ? null
                            : Text(option.hint ?? option.lines.map((line) => line.name).join(', ')),
                        onTap: () => Navigator.of(context).pop(name),
                      );
                    },
                  ),
          ),
        ]),
      ),
    );
  }
}
