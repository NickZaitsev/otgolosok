/// The story of a map place, `GET /api/content/places/{id}` (port of `src/features/explore/place-story.ts`).
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/json_read.dart' show jsIsSafeInteger;

/// A place photo from our origin or an approved Flickr embed, with its author and source shown in the viewer.
@immutable
class PlacePhoto {
  const PlacePhoto({
    required this.src,
    required this.thumbnail,
    required this.width,
    required this.height,
    required this.alt,
    required this.author,
    required this.sourceUrl,
    required this.license,
    required this.licenseUrl,
  });

  /// Our relative path (`/api/place-images/…`, `/images/places/…`) or an absolute Flickr URL.
  final String src;
  final String thumbnail;
  final int width;
  final int height;
  final String alt;
  final String? author;
  final String sourceUrl;
  final String license;
  final String licenseUrl;

  Map<String, Object?> toJson() => {
        'alt': alt,
        'author': author,
        'height': height,
        'license': license,
        'licenseUrl': licenseUrl,
        'sourceUrl': sourceUrl,
        'src': src,
        'thumbnail': thumbnail,
        'width': width,
      };
}

/// What the map index knows about a point: enough to open a linked place before its cell loads.
@immutable
class PlaceHeader {
  const PlaceHeader({required this.title, required this.address, required this.location});

  final String title;
  final String address;
  final GeoPoint location;

  Map<String, Object?> toJson() => {
        'address': address,
        'location': {'lat': location.lat, 'lon': location.lon},
        'title': title,
      };
}

/// The data.mos.ru licence requires a link to the portal wherever its data is used.
@immutable
class SourceAttribution {
  const SourceAttribution({required this.url, required this.label});

  final String url;

  /// Russian source text, translated by the UI.
  final String label;

  Map<String, Object?> toJson() => {'label': label, 'url': url};
}

@immutable
class PlaceStory {
  const PlaceStory({
    required this.paragraphs,
    required this.actualLocale,
    this.attribution,
    this.audioUrl,
    this.durationSec,
    this.photo,
    this.place,
  });

  final List<String> paragraphs;

  /// Language of the returned editorial text; legacy responses are Russian.
  final AppLocale actualLocale;
  final SourceAttribution? attribution;

  /// Usually a path on our origin (`/api/story-audio/…`).
  final String? audioUrl;
  final double? durationSec;
  final PlacePhoto? photo;
  final PlaceHeader? place;

  Map<String, Object?> toJson() => {
        'actualLocale': actualLocale.name,
        if (attribution != null) 'attribution': attribution!.toJson(),
        if (audioUrl != null) 'audioUrl': audioUrl,
        if (durationSec != null) 'durationSec': durationSec,
        'paragraphs': paragraphs,
        if (photo != null) 'photo': photo!.toJson(),
        if (place != null) 'place': place!.toJson(),
      };
}

const openDataLabel = 'Портал открытых данных Правительства Москвы';

final _photoPath = RegExp(r'^(?:/api/place-images/[a-f0-9]{64}|/images/places/[a-z0-9-]+)\.jpg$');
final _flickrImage = RegExp(r'^https://live\.staticflickr\.com/\d+/(\d+)_([a-f0-9]+)_(q|b)\.jpg$');
final _flickrPage = RegExp(r'^https://www\.flickr\.com/photos/[^/?#]+/(\d+)/?$');

String? _text(Object? value) => value is String && value.trim().isNotEmpty ? value.trim() : null;

/// `new URL(value).href` for http(s) links; anything else is no link.
String? _webUrl(Object? value) {
  if (value is! String) return null;
  final Uri url;
  try {
    url = Uri.parse(value.trim());
  } on FormatException {
    return null;
  }
  if ((url.scheme != 'https' && url.scheme != 'http') || url.host.isEmpty) return null;
  // WHATWG URLs always carry a path: «https://example.org» is «https://example.org/».
  return (url.path.isEmpty ? url.replace(path: '/') : url).toString();
}

int? _size(Object? value) => jsIsSafeInteger(value) && (value! as num) > 0 ? (value as num).toInt() : null;

/// The photo of a place detail; anything malformed means no photo, never a broken story.
PlacePhoto? parsePlacePhoto(Object? value) {
  if (value is! Map<String, Object?>) return null;
  final thumbnail = value['thumbnail'], src = value['src'];
  final local = thumbnail is String && _photoPath.hasMatch(thumbnail) && src is String && _photoPath.hasMatch(src);
  final thumb = thumbnail is String ? _flickrImage.firstMatch(thumbnail) : null;
  final full = src is String ? _flickrImage.firstMatch(src) : null;
  final sourceUrl = value['sourceUrl'];
  final flickr = thumb != null &&
      full != null &&
      thumb[1] == full[1] &&
      thumb[2] == full[2] &&
      thumb[3] == 'q' &&
      full[3] == 'b' &&
      sourceUrl is String &&
      _flickrPage.firstMatch(sourceUrl)?[1] == full[1];
  if (!local && !flickr) return null;
  final width = _size(value['width']), height = _size(value['height']);
  final alt = _text(value['alt']), license = _text(value['license']);
  final source = _webUrl(sourceUrl), licenseUrl = _webUrl(value['licenseUrl']);
  final author = value['author'];
  if (author != null && author is! String) return null;
  if (width == null || height == null || alt == null || license == null || source == null || licenseUrl == null) return null;
  return PlacePhoto(
    src: src! as String,
    thumbnail: thumbnail! as String,
    width: width,
    height: height,
    alt: alt,
    author: _text(author),
    sourceUrl: source,
    license: license,
    licenseUrl: licenseUrl,
  );
}

double? _coordinate(Object? value, double limit) => value is num && value.isFinite && value.abs() <= limit ? value.toDouble() : null;

/// The title and address as the map index shows them: the story title, else the place name; the address, else the name.
PlaceHeader? _parsePlaceHeader(Map<String, Object?> place, Object? storyTitle) {
  final location = place['location'];
  final lat = location is Map<String, Object?> ? _coordinate(location['lat'], 90) : null;
  final lon = location is Map<String, Object?> ? _coordinate(location['lon'], 180) : null;
  final name = _text(place['name']);
  if (lat == null || lon == null || name == null) return null;
  return PlaceHeader(title: _text(storyTitle) ?? name, address: _text(place['address']) ?? name, location: GeoPoint(lat, lon));
}

const _fallbackReasons = {'missing', 'draft', 'stale'};
const _invalidStory = FormatException('Некорректный ответ рассказа.');

AppLocale? _locale(Object? value) => value is String ? AppLocale.parse(value) : null;

/// Validates the server's localization decision. An omitted block is a legacy Russian response.
AppLocale _contentLocale(Map<String, Object?> text, AppLocale requestedLocale) {
  if (!text.containsKey('localization')) return AppLocale.ru;
  final localization = text['localization'];
  if (localization is! Map<String, Object?>) throw _invalidStory;
  final requested = _locale(localization['requestedLocale']);
  final content = _locale(localization['contentLocale']);
  final fallback = localization['fallbackReason'];
  if (requested == null || content == null || requested != requestedLocale) throw _invalidStory;
  if (requested == content) {
    if (fallback != null) throw _invalidStory;
  } else if (content != AppLocale.ru || fallback is! String || !_fallbackReasons.contains(fallback)) {
    throw _invalidStory;
  }
  return content;
}

SourceAttribution? _openDataAttribution(Object? sources) {
  if (sources is! List<Object?>) return null;
  for (final source in sources) {
    if (source is Map<String, Object?> && source['publisher'] == 'data.mos.ru') {
      final url = source['url'];
      if (url is String && url.startsWith('https://data.mos.ru/')) return SourceAttribution(url: url, label: openDataLabel);
    }
  }
  return null;
}

/// Maps `GET /api/content/places/{id}` to the sheet body; a body without a published text is malformed.
PlaceStory parsePlaceStory(Object? value, [AppLocale requestedLocale = AppLocale.ru]) {
  final place = value is Map<String, Object?> ? value['place'] : null;
  final text = place is Map<String, Object?> ? place['text'] : null;
  final story = text is Map<String, Object?> ? text['story'] : null;
  if (story is! Map<String, Object?> || story['paragraphs'] is! List<Object?>) throw _invalidStory;
  place as Map<String, Object?>;
  text as Map<String, Object?>;
  final actualLocale = _contentLocale(text, requestedLocale);
  final paragraphs = <String>[
    for (final paragraph in story['paragraphs']! as List<Object?>)
      if (paragraph is Map<String, Object?>)
        if (paragraph['text'] case final String body when body.trim().isNotEmpty) body,
  ];
  final audio = text['audio'];
  final audioMap = audio is Map<String, Object?> ? audio : const <String, Object?>{};
  if (audioMap.containsKey('language') && _locale(audioMap['language']) == null) throw _invalidStory;
  final url = audioMap['url'];
  final audioUrl = url is String && url.isNotEmpty ? url : null;
  if (audioUrl != null && (_locale(audioMap['language']) ?? AppLocale.ru) != actualLocale) throw _invalidStory;
  final duration = audioMap['durationSec'];
  final durationSec = audioUrl != null && duration is num && duration.isFinite && duration > 0 ? duration.toDouble() : null;
  return PlaceStory(
    paragraphs: List.unmodifiable(paragraphs),
    actualLocale: actualLocale,
    attribution: _openDataAttribution(story['sources']),
    audioUrl: audioUrl,
    durationSec: durationSec,
    photo: parsePlacePhoto(place['photo']),
    place: _parsePlaceHeader(place, story['title']),
  );
}

/// Where the place detail lives; ids are `osm:node:1`-like and go into the path as the site sends them.
String placeStoryPath(String id) => '/api/content/places/$id';

/// Loads place stories: one request per place and language for every open sheet, the last 100 kept for the
/// session (reopening a story makes no request), a 404 means the story was unpublished (null).
class PlaceStoryRepository {
  PlaceStoryRepository(this._api, {this.cacheLimit = 100});

  final ApiClient _api;
  final int cacheLimit;
  final _stories = <String, PlaceStory>{};
  final _pending = <String, Future<PlaceStory?>>{};

  static String _key(String id, AppLocale locale) => '${locale.name}:$id';

  /// The cached story, if any, without a request.
  PlaceStory? cached(String id, AppLocale locale) => _stories[_key(id, locale)];

  Future<PlaceStory?> load(String id, AppLocale locale) {
    final key = _key(id, locale);
    final cached = _stories.remove(key);
    if (cached != null) {
      _stories[key] = cached;
      return Future.value(cached);
    }
    // A block body: returning the removed future from whenComplete would make the request wait for itself.
    return _pending[key] ??= _fetch(id, locale, key).whenComplete(() {
      _pending.remove(key);
    });
  }

  Future<PlaceStory?> _fetch(String id, AppLocale locale, String key) async {
    try {
      final story = await _api.get(
        placeStoryPath(id),
        (json) => parsePlaceStory(json, locale),
        // The language is fixed per request so the cached copy matches the key even if the UI switches meanwhile.
        query: locale == AppLocale.ru ? null : {'lang': locale.name},
      );
      _stories[key] = story;
      if (_stories.length > cacheLimit) _stories.remove(_stories.keys.first);
      return story;
    } on ApiError catch (error) {
      if (error.status == 404) return null;
      rethrow;
    }
  }

  /// Forgets cached stories (e.g. after the catalog revalidated and a story may have changed).
  void clear() => _stories.clear();
}

final placeStoryRepositoryProvider = Provider<PlaceStoryRepository>((ref) => PlaceStoryRepository(ref.watch(apiProvider)));
