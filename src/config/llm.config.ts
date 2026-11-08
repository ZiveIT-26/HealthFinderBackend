import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

/**
 * All texts and settings of the LLM part, from three files in this folder:
 *   llm.config.yaml  doctor websites (allowed domains, sources)
 *   prompts.yaml     everything the model reads (prompts, tool texts)
 *   messages.yaml    everything the user sees that is not written by the model
 * The three are merged into one object; code reads it as `llmConfig.<key>`.
 */
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
    searchPlanner: string;
    townPicker: string;
    emergencyResponse: string;
    responseFormatter: string;
  };
  transcript: TranscriptLabels;
  /** {towns}, {userTown} */
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
    /** {count} */
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
  /** {specialities} */
  otherSpecialities: string;
};

const CONFIG_FILES = ['llm.config.yaml', 'prompts.yaml', 'messages.yaml'];

/** Reads and merges the three files. Also used directly by tests and scripts. */
export function loadLlmConfig(): LlmConfig {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  return Object.assign(
    {},
    ...CONFIG_FILES.map((file) => parse(readFileSync(join(folder, file), 'utf8')) as object),
  ) as LlmConfig;
}

export default registerAs('llm', loadLlmConfig);
