import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/route.dart';
import '../../walk_engine/walk_view.dart' show ContentLocale;

/// Site `ContentLanguageNote`: the interface may be translated while the story is not; null when
/// there is nothing to say.
String? contentLanguageNote(AppLocale interface, ContentLocale content, {required bool audioAvailable}) {
  if (interface == AppLocale.ru) return null;
  if (content == ContentLocale.ru) {
    return audioAvailable
        ? 'Текст и аудио этой истории пока доступны только на русском языке.'
        : 'Текст этой истории пока доступен только на русском языке. Озвучка готовится.';
  }
  if (content.name == interface.name && !audioAvailable) return 'Озвучка этой истории на выбранном языке ещё готовится.';
  return null;
}

class ContentLanguageNote extends StatelessWidget {
  const ContentLanguageNote({super.key, required this.contentLocale, required this.audioAvailable});

  final ContentLocale contentLocale;
  final bool audioAvailable;

  @override
  Widget build(BuildContext context) {
    final note = contentLanguageNote(context.appLocale, contentLocale, audioAvailable: audioAvailable);
    if (note == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
      child: Text(context.t(note), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TokenColors.muted)),
    );
  }
}

/// The story text of a stop with «Откуда это известно?» (sources, the check date, facts and the
/// editorial note): site `StoryText` + `StorySources`.
class StoryView extends StatefulWidget {
  const StoryView({super.key, required this.content, required this.contentLocale});

  final HistoricalContent content;
  final ContentLocale contentLocale;

  @override
  State<StoryView> createState() => _StoryViewState();
}

class _StoryViewState extends State<StoryView> {
  bool _sources = false;
  bool _facts = false;
  bool _linkFailed = false;

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    var opened = false;
    if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
      try {
        opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      } on Object {
        opened = false;
      }
    }
    if (mounted) setState(() => _linkFailed = !opened);
  }

  String? _checkedAt(BuildContext context) {
    final raw = widget.content.story.checkedAt;
    final date = raw.isEmpty ? null : DateTime.tryParse(raw);
    if (date == null) return null;
    return MaterialLocalizations.of(context).formatFullDate(date.toUtc()).replaceFirst(RegExp(r'^[^,]+,\s*'), '');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = widget.content;
    final note = theme.textTheme.bodySmall?.copyWith(color: TokenColors.muted);
    final checkedAt = _checkedAt(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final paragraph in content.story.paragraphs)
        Padding(
          padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
          child: Text(paragraph.text, style: theme.textTheme.bodyLarge),
        ),
      if (content.sources.isNotEmpty) ...[
        TextButton(
          onPressed: () => setState(() => _sources = !_sources),
          child: Text(_sources ? context.t('Скрыть источники') : context.t('Откуда это известно?')),
        ),
        if (_sources) ...[
          Text(
            checkedAt == null ? context.t('Дата проверки не указана.') : context.t('Проверено по публикациям {date}', {'date': checkedAt}),
            style: note,
          ),
          const SizedBox(height: TokenSizes.spaceXs),
          for (final (index, source) in content.sources.indexed)
            Semantics(
              link: true,
              child: InkWell(
                onTap: () => _open(source.url),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceXs),
                  child: Text('${index + 1}. ${source.title}', style: const TextStyle(color: TokenColors.focus, decoration: TextDecoration.underline)),
                ),
              ),
            ),
          if (_linkFailed)
            Semantics(liveRegion: true, child: Text(context.t('Не удалось открыть ссылку.'), style: note)),
          if (content.facts.isNotEmpty) ...[
            TextButton(
              onPressed: () => setState(() => _facts = !_facts),
              child: Text(context.t('Факты и подтверждения · {count}', {'count': content.facts.length})),
            ),
            if (_facts)
              for (final fact in content.facts)
                Padding(
                  padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: fact.claim),
                    for (final id in fact.sourceIds)
                      if (content.sources.indexWhere((source) => source.id == id) case final index when index >= 0)
                        TextSpan(text: ' [${index + 1}]', style: note),
                  ])),
                ),
          ],
          if (content.editorialNote.isNotEmpty) Text(content.editorialNote, style: note),
        ],
      ],
    ]);
  }
}
