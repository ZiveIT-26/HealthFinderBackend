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

  public async getSessionHistory(sessionId: string) {
    const result = await this.pool.query(
      'SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      { params: [sessionId] },
    );

    return result.rows;
  }
}
