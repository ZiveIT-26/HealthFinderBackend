import type { HttpService } from '@nestjs/axios';
import type { LlmConfig } from '../../../config/llm.config.js';
import type { DoctorSource } from './doctor-source.js';
import { ZoznamLekarovClient } from './adapters/zoznam-lekarov.client.js';

export type { DoctorListing, DoctorSource, Speciality, Town } from './doctor-source.js';

// sites of trusted place here
export function createDoctorSources(httpService: HttpService, llmConfig: LlmConfig): DoctorSource[] {
  return [
    new ZoznamLekarovClient(httpService, llmConfig),
  ];
}
