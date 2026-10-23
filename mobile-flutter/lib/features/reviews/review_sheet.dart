import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../walks/user_message.dart';
import 'review_model.dart';
import 'reviews_api.dart';
import 'walk_reviews_controller.dart';

/// How long the thank-you message stays before the sheet closes itself.
const reviewSentClose = Duration(seconds: 3);

/// The rating form in its own sheet over the walk screen (site `review-dialog.tsx`): it only sends,
/// then thanks the author and closes itself.
Future<void> showReviewSheet(BuildContext context, {required WalkReviewsController reviews, required String walkTitle}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => ReviewSheet(reviews: reviews, walkTitle: walkTitle),
    );

class ReviewSheet extends StatefulWidget {
  const ReviewSheet({super.key, required this.reviews, required this.walkTitle});
  final WalkReviewsController reviews;
  final String walkTitle;

  @override
  State<ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<ReviewSheet> {
  // Fixed when the sheet opens, so a successful send does not retitle it under the thank-you message.
  late final bool _hadReview = widget.reviews.mine != null;
  String? _sent;
  Timer? _close;

  @override
  void dispose() {
    _close?.cancel();
    super.dispose();
  }

  void _onSent(String message) {
    setState(() => _sent = message);
    _close = Timer(reviewSentClose, () {
      if (mounted) Navigator.of(context).maybePop();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: ListenableBuilder(
          listenable: widget.reviews,
          builder: (context, _) {
            final reviews = widget.reviews;
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Semantics(
                      header: true,
                      child: Text(_hadReview ? context.t('Ваш отзыв') : context.t('Оцените прогулку'), style: theme.textTheme.titleLarge),
                    ),
                    Text(widget.walkTitle, style: theme.textTheme.bodySmall),
                  ]),
                ),
                IconButton(tooltip: context.t('Закрыть'), icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
              ]),
              const SizedBox(height: 8),
              if (_sent != null)
                Semantics(liveRegion: true, child: Text(_sent!.isEmpty ? context.t('Спасибо!') : _sent!, style: theme.textTheme.titleMedium))
              else if (reviews.state == ReviewsState.unavailable) ...[
                Text(context.t('Отзывы сейчас недоступны.')),
                Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: reviews.reload, child: Text(context.t('Повторить')))),
              ] else if (reviews.state != ReviewsState.ready)
                Text(context.t('Загружаем отзывы…'))
              else
                ReviewForm(reviews: reviews, onSent: _onSent),
            ]);
          },
        ),
      ),
    );
  }
}

/// Keeps a text within [max] Unicode code points, as the site counts them.
class CodePointLimit extends TextInputFormatter {
  const CodePointLimit(this.max);
  final int max;

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    if (codePoints(newValue.text) <= max) return newValue;
    final text = String.fromCharCodes(newValue.text.runes.take(max));
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}

/// Stars and an optional text (site `review-form.tsx`, send-only mode).
class ReviewForm extends ConsumerStatefulWidget {
  const ReviewForm({super.key, required this.reviews, required this.onSent});
  final WalkReviewsController reviews;
  final ValueChanged<String> onSent;

  @override
  ConsumerState<ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends ConsumerState<ReviewForm> {
  // A draft left by a failed send wins over the stored review: it holds the user's latest intent.
  late final ReviewInput _initial = widget.reviews.draft ??
      (widget.reviews.mine == null ? const ReviewInput(rating: 0, text: '') : ReviewInput(rating: widget.reviews.mine!.rating, text: widget.reviews.mine!.text));
  late int _rating = _initial.rating;
  late final TextEditingController _text = TextEditingController(text: _initial.text)..addListener(_changed);
  bool _busy = false;
  String _error = '';

  void _changed() => setState(() {});

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating == 0 || _busy) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    final result = await widget.reviews.save(ReviewInput(rating: _rating, text: _text.text.trim()));
    if (!mounted) return;
    setState(() => _busy = false);
    switch (result) {
      case ReviewActionDone(:final status):
        widget.onSent(switch (status) {
          ReviewStatus.published => context.t('Спасибо! Оценка учтена.'),
          ReviewStatus.pending => context.t('Спасибо! Отзыв появится после проверки редакцией.'),
          ReviewStatus.hidden => context.t('Отзыв скрыт редакцией.'),
          null => '',
        });
      case ReviewActionFailed(:final error):
        setState(() => _error = userMessage(context, error, context.t('Не удалось отправить отзыв. Повторите попытку.')));
    }
  }

  String _starLabel(int index) => switch (index) {
        0 => context.t('1 звезда из 5'),
        1 => context.t('2 звезды из 5'),
        2 => context.t('3 звезды из 5'),
        3 => context.t('4 звезды из 5'),
        _ => context.t('5 звёзд из 5'),
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(authUserProvider);
    final mine = widget.reviews.mine;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (mine?.status == ReviewStatus.pending) Text(context.t('На модерации'), style: theme.textTheme.labelMedium),
      if (mine?.status == ReviewStatus.hidden) Text(context.t('Скрыт редакцией'), style: theme.textTheme.labelMedium),
      Text(context.t('Оценка'), style: theme.textTheme.labelMedium),
      Row(children: [
        for (var index = 0; index < 5; index++)
          Semantics(
            selected: index + 1 == _rating,
            inMutuallyExclusiveGroup: true,
            child: IconButton(
              tooltip: _starLabel(index),
              iconSize: 32,
              color: TokenColors.mapOrange,
              icon: Icon(index < _rating ? Icons.star : Icons.star_border),
              onPressed: _busy ? null : () => setState(() => _rating = index + 1),
            ),
          ),
      ]),
      const SizedBox(height: 8),
      TextField(
        controller: _text,
        minLines: 3,
        maxLines: 6,
        enabled: !_busy,
        inputFormatters: const [CodePointLimit(reviewTextMax)],
        decoration: InputDecoration(labelText: context.t('Отзыв (необязательно)')),
      ),
      Align(
        alignment: Alignment.centerRight,
        child: Semantics(liveRegion: true, child: Text('${codePoints(_text.text)} / $reviewTextMax', style: theme.textTheme.bodySmall)),
      ),
      Text(
        user != null
            ? context.t('Отзыв будет опубликован с именем «{name}».', {'name': user.name})
            : context.t('Отзыв будет опубликован от имени «Гость». Изменить его можно только на этом устройстве.'),
        style: theme.textTheme.bodySmall,
      ),
      if (_error.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Semantics(liveRegion: true, child: Text(_error, style: const TextStyle(color: TokenColors.dangerInk))),
        ),
      const SizedBox(height: 12),
      FilledButton(
        onPressed: _rating == 0 || _busy ? null : _submit,
        child: Text(_busy
            ? context.t('Отправляем…')
            : _error.isNotEmpty
                ? context.t('Повторить')
                : context.t('Отправить отзыв')),
      ),
    ]);
  }
}
