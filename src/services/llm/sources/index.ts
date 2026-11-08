import type { HttpService } from '@nestjs/axios';
import type { LlmConfig } from '../../../config/llm.config.js';
import type { DoctorSource } from './doctor-source.js';
import { KskGeoportalAdapter } from './adapters/ksk-geoportal.adapter.js';
import { ZoznamLekarovClient } from './adapters/zoznam-lekarov.client.js';

export type { DoctorListing, DoctorSource, Speciality, Town } from './doctor-source.js';

// sites of trusted place here
// Order matters: doctors of the first source come first in the combined list.
export function createDoctorSources(httpService: HttpService, llmConfig: LlmConfig): DoctorSource[] {
  return [
    // Official KSK register: opening hours, insurers, coordinates.
    new KskGeoportalAdapter(llmConfig),
    // Doctor directory: a web page for every doctor.
    new ZoznamLekarovClient(httpService, llmConfig),
  ];
}
