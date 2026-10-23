/// A `GET /api/me/walks` card as the server sends it.
library;

const walkId = '123e4567-e89b-42d3-a456-426614174000';
const walkShareToken = '901d1133-44a2-4724-a856-2fe8d6c86a44';

Map<String, Object?> walkJson([Map<String, Object?> overrides = const {}]) => {
      'id': walkId,
      'title': 'Замоскворечье',
      'revision': 3,
      'updatedAt': '2026-10-20T10:00:00.000Z',
      'visibility': 'shared',
      'shareToken': walkShareToken,
      'listingStatus': null,
      'draft': false,
      'travelMode': 'walking',
      'totalMinutes': 60,
      'walkingMinutes': 60,
      'distanceM': 4200,
      ...overrides,
    };

