import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walk_builder/builder_storage.dart';
import 'package:otgolosok/features/walk_builder/walk_document.dart';

import 'support.dart';

void main() {
  group('DraftStore', () {
    test('saves when the stored text is the one the builder read', () async {
      final storage = MemoryBuilderStorage();
      final store = DraftStore(storage);
      final first = await store.save(startDraft(), null);
      final second = await store.save(startDraft().copyWith(minutes: 60), first);
      expect(await store.read(), second);
      expect(jsonDecode(second), containsPair('minutes', 60));
    });

    test('refuses to overwrite a draft changed elsewhere and keeps that draft', () async {
      final storage = MemoryBuilderStorage({BuilderKeys.draft: 'changed elsewhere'});
      final store = DraftStore(storage);
      await expectLater(store.save(startDraft(), null), throwsA(isA<StateError>().having((e) => e.message, 'message', draftConflictMessage)));
      expect(storage.values[BuilderKeys.draft], 'changed elsewhere');
    });

    test('never overwrites an unreadable draft it did not read', () async {
      final storage = MemoryBuilderStorage({BuilderKeys.draft: '{broken'});
      await expectLater(DraftStore(storage).save(startDraft(), 'something else'), throwsStateError);
      expect(storage.values[BuilderKeys.draft], '{broken');
    });
  });

  group('DeviceLocalWalkStore', () {
    const id = 'cccccccc-dddd-4eee-8fff-000000000001';
    Map<String, Object?> document([int minutes = 30]) => draftToWalkDocument(startDraft().copyWith(minutes: minutes), id);

    test('revisions count up and an outdated revision is a conflict', () async {
      final storage = MemoryBuilderStorage();
      final store = DeviceLocalWalkStore(storage);
      expect(await store.saveJson(document()), 0);
      expect(await store.saveJson(document(60), expectedRevision: 0), 1);
      await expectLater(store.saveJson(document(90), expectedRevision: 0), throwsStateError);
      await expectLater(store.saveJson(document(90)), throwsStateError);
      final saved = await store.getJson(id);
      expect(saved?.revision, 1);
      expect(saved?.document['id'], id);
      expect((await store.list()).single.revision, 1);
    });

    final damaged = {
      'not JSON': '{',
      'unknown version': jsonEncode({'version': 3, 'items': <String, Object?>{}}),
      'item under another ID': jsonEncode({
        'version': 2,
        'items': {
          'other': {'document': <String, Object?>{'id': id}, 'revision': 0},
        },
      }),
      'negative revision': jsonEncode({
        'version': 2,
        'items': {
          id: {'document': <String, Object?>{'id': id}, 'revision': -1},
        },
      }),
    };
    for (final MapEntry(key: name, value: raw) in damaged.entries) {
      test('a library with $name fails to read and is never rewritten', () async {
        final storage = MemoryBuilderStorage({BuilderKeys.walks: raw});
        final store = DeviceLocalWalkStore(storage);
        await expectLater(store.list(), throwsFormatException);
        await expectLater(store.saveJson(document()), throwsFormatException);
        expect(storage.values[BuilderKeys.walks], raw);
      });
    }

    test('an invalid walk document is not saved', () async {
      final storage = MemoryBuilderStorage();
      await expectLater(DeviceLocalWalkStore(storage).saveJson({...document(), 'version': 9}), throwsFormatException);
      expect(storage.values, isEmpty);
    });
  });

  group('FileBuilderStorage', () {
    late Directory directory;
    setUp(() => directory = Directory.systemTemp.createTempSync('walk-builder-'));
    tearDown(() => directory.deleteSync(recursive: true));

    test('writes, reads back and removes; a missing key reads as null', () async {
      final storage = FileBuilderStorage(() async => Directory('${directory.path}/nested'));
      expect(await storage.read(BuilderKeys.draft), isNull);
      await storage.write(BuilderKeys.draft, 'один');
      await storage.write(BuilderKeys.draft, 'два');
      expect(await storage.read(BuilderKeys.draft), 'два');
      expect(directory.listSync(recursive: true).whereType<File>().where((file) => file.path.endsWith('.tmp')), isEmpty);
      await storage.remove(BuilderKeys.draft);
      await storage.remove(BuilderKeys.draft);
      expect(await storage.read(BuilderKeys.draft), isNull);
    });

    test('rejects keys that are not file-safe', () async {
      final storage = FileBuilderStorage(() async => directory);
      for (final key in ['../draft', 'Draft', '', 'a/b']) {
        await expectLater(storage.write(key, 'x'), throwsArgumentError, reason: key);
      }
    });

    test('a directory that failed to open is tried again on the next call', () async {
      var attempts = 0;
      final storage = FileBuilderStorage(() async {
        if (++attempts == 1) throw const FileSystemException('not yet');
        return directory;
      });
      await expectLater(storage.read(BuilderKeys.draft), throwsA(isA<FileSystemException>()));
      expect(await storage.read(BuilderKeys.draft), isNull);
      expect(attempts, 2);
    });
  });
}
