import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('YOHaku board', () => {
  it('renders the demo home page', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('話したいことに');
    expect(response.text).toContain('YOHaku');
  });

  it('supports demo search', async () => {
    const response = await request(app).get('/search').query({ q: '個人開発' });
    expect(response.status).toBe(200);
    expect(response.text).toContain('最初の100人');
  });

  it('exposes a health endpoint', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('returns a branded 404 page', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.text).toContain('ページが見つかりません');
  });
});
