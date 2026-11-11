import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'postgrejs';
import { ConfigService } from '@nestjs/config';

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
