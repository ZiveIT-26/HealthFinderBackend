import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

export type LlmConfig = SourcesConfig & PromptsConfig & MessagesConfig & KskGeoportalConfig;

// --- llm.config.yaml ---
type SourcesConfig = {
  allowedApiDomains: string[];
  trustedDoctorSources: DoctorSource[];
};

// --- ksk-geoportal.yaml ---
type KskGeoportalConfig = {
  kskGeoportal: {
    /** Our speciality name -> facility types in the register. */
    specialities: Record<string, FacilityType[]>;
  };
};

export type FacilityType = {
  /** Exact value of `druh_zariadenia`. */
  type: string;
  /** Optional part of `typ_zariadenia_complex_code` (e.g. "dospeli", "deti_a_dorast"). */
  codeIncludes?: string;
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
    /** Added to `assistant` only when web_search is on (TAVILY_API_KEY set). */
    webSearchNote: string;
    searchPlanner: string;
    townPicker: string;
    emergencyResponse: string;
    responseFormatter: string;
  };
  transcript: TranscriptLabels;
  townPickerInput: string;
  doctorResponse: {
    urlField: string;
  };
  findDoctors: FindDoctorsTexts;
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
  /** {hours} */
  openingHours: string;
  /** {insurers} */
  insurers: string;
  /** Short day names, keyed by the register's field names (pondelok, utorok, ...). */
  days: Record<string, string>;
};

const CONFIG_FILES = ['llm.config.yaml', 'prompts.yaml', 'messages.yaml', 'ksk-geoportal.yaml'];

export function loadLlmConfig(): LlmConfig {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  return Object.assign(
    {},
    ...CONFIG_FILES.map((file) => parse(readFileSync(join(folder, file), 'utf8')) as object),
  ) as LlmConfig;
}

export default registerAs('llm', loadLlmConfig);
