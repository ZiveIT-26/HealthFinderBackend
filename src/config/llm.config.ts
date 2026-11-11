import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

export type LlmConfig = SourcesConfig & PromptsConfig & MessagesConfig;

// --- llm.config.yaml ---
type SourcesConfig = {
  allowedApiDomains: string[];
  trustedDoctorSources: DoctorSource[];
};

export type DoctorSource = {
  domain: string;
  description: string;
  apiInstructions: string;
};

// --- prompts.yaml ---
type PromptsConfig = {
  systemPrompts: {
    assistant: string;
    triage: string;
    urgentNote: string;
    webSearchNote: string;
    emergencyResponse: string;
    emergencyMemory: string;
    responseFormatter: string;
  };
  transcript: TranscriptLabels;
  doctorResponse: {
    urlField: string;
  };
  findDoctors: FindDoctorsTexts;
  findMedicalFacility: FindMedicalFacilityTexts;
};

export type FindMedicalFacilityTexts = {
  resultHeader: string;
  resultHeaderPartial: string;
  resultFacility: string;
  resultMore: string;
  resultFooter: string;
  noResults: string;
  failed: string;
  anywhere: string;
  nearby: string;
  distance: string;
};

export type TranscriptLabels = {
  earlier: string;
  latest: string;
  user: string;
  assistant: string;
};

export type FindDoctorsTexts = {
  description: string;
  specialityField: string;
  townField: string;
  resultHeader: string;
  resultHeaderPartial: string;
  resultSource: string;
  resultDoctor: string;
  resultMore: string;
  resultFooter: string;
  noSpeciality: string;
  noTownsForSpeciality: string;
  noTown: string;
  noDoctors: string;
  noSources: string;
};

// --- messages.yaml ---
type MessagesConfig = {
  fallbackMessages: {
    emergency: string;
    answerFailed: string;
    doctorsFound: string;
  };
  errors: {
    messageRequired: string;
    streamNotFound: string;
    streamFailed: string;
  };
  doctorList: DoctorListTexts;
};

export type DoctorListTexts = {
  addressMissing: string;
  otherSpecialities: string;
  openingHours: string;
  insurers: string;
  days: Record<string, string>;
  distance: string;
};

const CONFIG_FILES = ['llm.config.yaml', 'prompts.yaml', 'messages.yaml'];

export function loadLlmConfig(): LlmConfig {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  return Object.assign(
    {},
    ...CONFIG_FILES.map((file) => parse(readFileSync(join(folder, file), 'utf8')) as object),
  ) as LlmConfig;
}

export default registerAs('llm', loadLlmConfig);
