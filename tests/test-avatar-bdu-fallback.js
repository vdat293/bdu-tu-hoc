import assert from 'node:assert/strict';
import { BduServiceInternals } from '../src/services/bdu.service.js';
import { IdentityPresentationInternals } from '../src/services/identity-presentation.service.js';

const { findStudentImage, normalizeStudentImageValue } = BduServiceInternals;
const { normalizeAvatarUrl } = IdentityPresentationInternals;

// Sample 1x1 JPEG base64 (always starts with /9j/)
const sampleJpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCqAAB//9k=';
const samplePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 1. normalizeStudentImageValue handles JPEG base64 starting with /9j/
const normalizedJpeg = normalizeStudentImageValue(sampleJpeg);
assert.ok(normalizedJpeg.startsWith('data:image/jpeg;base64,/9j/'), 'JPEG base64 starting with /9j/ must be prefixed with data URI');

// 2. normalizeStudentImageValue handles PNG base64
const normalizedPng = normalizeStudentImageValue(samplePng);
assert.ok(normalizedPng.startsWith('data:image/png;base64,iVBOR'), 'PNG base64 must be prefixed with image/png');

// 3. Pre-formatted data URLs are preserved
assert.equal(normalizeStudentImageValue('data:image/jpeg;base64,' + sampleJpeg), 'data:image/jpeg;base64,' + sampleJpeg);

// 4. HTTP and HTTPS URLs are preserved
assert.equal(normalizeStudentImageValue('https://sv.bdu.edu.vn/images/123.jpg'), 'https://sv.bdu.edu.vn/images/123.jpg');
assert.equal(normalizeStudentImageValue('/images/avatar.jpg'), '/images/avatar.jpg');

// 5. findStudentImage extracts from various structures
assert.ok(findStudentImage({ data: { thong_tin_sinh_vien: { image: sampleJpeg } } }).startsWith('data:image/jpeg;base64,'));
assert.ok(findStudentImage({ data: [{ hinh_anh: sampleJpeg }] }).startsWith('data:image/jpeg;base64,'));
assert.ok(findStudentImage({ student_image: samplePng }).startsWith('data:image/png;base64,'));
assert.ok(findStudentImage(JSON.stringify({ data: { image: sampleJpeg } })).startsWith('data:image/jpeg;base64,'));

// 6. normalizeAvatarUrl does NOT accept base64 or /9j/ into SQL column
assert.equal(normalizeAvatarUrl(sampleJpeg), null, 'Raw JPEG base64 must not be treated as relative URL path');
assert.equal(normalizeAvatarUrl('data:image/jpeg;base64,' + sampleJpeg), null, 'Data URIs must not be stored in SQL avatar_url column');
assert.equal(normalizeAvatarUrl('/images/avatar.jpg'), 'https://sv.bdu.edu.vn/images/avatar.jpg');
assert.equal(normalizeAvatarUrl('https://example.com/photo.webp'), 'https://example.com/photo.webp');

console.log('✓ All avatar BDU fallback & normalization tests passed successfully.');
