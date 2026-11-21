import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'postgrejs';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

@Injectable()
export class DbService implements OnModuleDestroy {
  public pool: Pool;
  private readonly logger = new Logger(DbService.name);

  constructor(private configService: ConfigService) {
    const connectionString = this.configService.get<string>(
      'DB_CONNECTION_STRING',
    );

    if (!connectionString) {
      throw new Error('DB_CONNECTION_STRING is not defined in the environment');
    }

    this.pool = new Pool(connectionString);
  }

  async onModuleDestroy() {
    this.logger.log('Closing database pool...');
    await this.pool.close();
  }

  public async saveMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    await this.pool.query(
      'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
      { params: [sessionId, role, content] },
    );
  }

  public async createSession(sessionId: string, userId: string): Promise<void> {
    await this.ensureUser(userId);
    await this.pool.query(
      'INSERT INTO sessions (id, user_id) VALUES ($1, $2)',
      { params: [sessionId, userId] },
    );
  }

  public async setSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET title = $1 WHERE id = $2',
      { params: [title, sessionId] },
    );
  }

  public async getSessionTitle(sessionId: string): Promise<string | null | undefined> {
    const result = await this.pool.query(
      'SELECT title FROM sessions WHERE id = $1',
      { params: [sessionId], objectRows: true },
    );

    const row = result.rows?.[0];
    return row ? (row.title ?? null) : undefined;
  }

  public async listSessions(
    userId: string,
  ): Promise<{ id: string; title: string | null; createdAt: Date }[]> {
    const result = await this.pool.query(
      'SELECT id, title, created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC',
      { params: [userId], objectRows: true },
    );

    return (result.rows ?? []).map(
      (row: { id: string; title: string | null; created_at: Date }) => ({
        id: String(row.id),
        title: row.title ?? null,
        createdAt: row.created_at,
      }),
    );
  }

  public async getSessionUserId(sessionId: string): Promise<string | undefined> {
    const result = await this.pool.query(
      'SELECT user_id FROM sessions WHERE id = $1',
      { params: [sessionId], objectRows: true },
    );

    return result.rows?.[0]?.user_id;
  }

  public async getSessionHistory(sessionId: string) {
    const result = await this.pool.query(
      'SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      { params: [sessionId], objectRows: true },
    );

    return result.rows;
  }

  public async getMemories(userId: string): Promise<{ id: string; content: string }[]> {
    const result = await this.pool.query(
      'SELECT id, content FROM user_memories WHERE user_id = $1 ORDER BY created_at ASC, id ASC',
      { params: [userId], objectRows: true },
    );

    return (result.rows ?? []).map((row: { id: string | number; content: string }) => ({
      id: String(row.id),
      content: row.content,
    }));
  }

  public async ensureUser(userId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      { params: [userId] },
    );
  }

  public async findOrCreateGoogleUser(input: {
    subject: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  }): Promise<{
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  }> {
    const result = await this.pool.query(
      `INSERT INTO users (id, google_subject, email, display_name, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_subject) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url
       RETURNING id, email, display_name, avatar_url`,
      {
        params: [
          randomUUID(),
          input.subject,
          input.email,
          input.displayName,
          input.avatarUrl,
        ],
        objectRows: true,
      },
    );

    const user = result.rows?.[0];
    if (!user) {
      throw new Error('Google user could not be persisted');
    }

    return {
      id: String(user.id),
      email: String(user.email),
      displayName: user.display_name ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  public async saveMemory(userId: string, content: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO user_memories (user_id, content) VALUES ($1, $2) ON CONFLICT (user_id, content) DO NOTHING',
      { params: [userId, content] },
    );
  }

  public async updateMemory(userId: string, id: string, content: string): Promise<void> {
    await this.pool.query(
      'UPDATE user_memories SET content = $1 WHERE user_id = $2 AND id = $3',
      { params: [content, userId, id] },
    );
  }

  public async deleteMemory(userId: string, id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM user_memories WHERE user_id = $1 AND id = $2',
      { params: [userId, id] },
    );
  }
}
