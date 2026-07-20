import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('Kapibara Board', () => {
  it('renders the demo home page', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('好きな話を');
    expect(response.text).toContain('Kapibara Board');
  });

  it('renders the search results page', async () => {
    const response = await request(app).get('/search').query({ q: '個人開発' });
    expect(response.status).toBe(200);
    expect(response.text).toContain('「個人開発」の検索結果');
  });

  it('exposes a health endpoint', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('returns a branded 404 page', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.text).toContain('ページが見つからなかったよ');
  });

  it('protects member and admin pages', async () => {
    const [members, messages, admin] = await Promise.all([
      request(app).get('/members'),
      request(app).get('/messages'),
      request(app).get('/admin'),
    ]);
    expect(members.status).toBe(302);
    expect(messages.status).toBe(302);
    expect(admin.status).toBe(302);
  });
});
