import { loadLlmConfig } from '../../../config/llm.config.js';
import {
  createFacilityToolForModel,
  type Facility,
  facilityResult,
  facilityToDoctor,
  inCounty,
  inTown,
  searchFacilities,
  townOf,
  withoutDuplicateFacilities,
} from './facility-result.js';
import type { createFindMedicalFacilityTool } from './find-medical-facility.tool.js';

const config = loadLlmConfig();

// A record as find_medical_facility returns it (from find_facility_by_query.py output).
const periodental: Facility = {
  geometry: { type: 'Point', coordinates: [21.252767, 48.722419] },
  properties: {
    druh_zariadenia: 'ambulancia zubného lekárstva',
    nazov_zariadenia: 'PeriODental súkromná zubná klinika, Košice-Staré Mesto, (Periodental s.r.o.)',
    addressline: 'Poštová 536/14, 04001 Košice-Staré Mesto, Slovenská republika',
    municipality: 'Košice - mestská časť Staré Mesto',
    county: 'Košice I',
    email: null,
    mobil: null,
    telefon: '+421 917600777, +421 940655677',
    odborni_zastupcovia: 'MUDr. Timková Silvia, PhD. ako zubný lekár',
    pondelok: '7:30 - 15:30',
    utorok: '7:30 - 15:30',
    streda: '7:30 - 15:30',
    stvrtok: '7:30 - 15:30',
    piatok: '7:30 - 13:00',
    sobota: null,
    nedela: null,
    union: 'áno',
    vszp: 'áno',
    dovera: 'áno',
    distance_to_home_km: 0.55,
  },
};

const at = (name: string, municipality: string, county: string): Facility => ({
  geometry: null,
  properties: { nazov_zariadenia: name, addressline: `${name} street`, municipality, county },
});

describe('townOf / inTown', () => {
  const kosiceI = at('A', 'Košice - mestská časť Staré Mesto', 'Košice I');
  const kosiceII = at('B', 'Košice - mestská časť Západ', 'Košice II');
  const secovce = at('C', 'Sečovce', 'Trebišov');

  it('turns a Košice city part into its district, other places stay the municipality', () => {
    expect(townOf(kosiceI)).toBe('Košice I');
    expect(townOf(secovce)).toBe('Sečovce');
  });

  it('keeps exactly the requested town (the tool ILIKE "Košice I" also returns Košice II)', () => {
    expect(inTown([kosiceI, kosiceII, secovce], 'Košice I')).toEqual([kosiceI]);
    expect(inTown([kosiceI, kosiceII, secovce], 'Sečovce')).toEqual([secovce]);
  });
});

describe('withoutDuplicateFacilities', () => {
  it('drops a second record with the same name and address', () => {
    const a = at('A', 'Michalovce', 'Michalovce');
    expect(withoutDuplicateFacilities([a, { ...a }, at('B', 'Michalovce', 'Michalovce')])).toHaveLength(2);
  });
});

describe('facilityToDoctor', () => {
  it('keeps phone, hours, insurers and adds a map link', () => {
    expect(facilityToDoctor(periodental, 'Zubár (stomatológ)', config.doctorList)).toEqual({
      name: 'PeriODental súkromná zubná klinika, Košice-Staré Mesto, (Periodental s.r.o.)',
      speciality: 'Zubár (stomatológ)',
      address: 'Poštová 536/14, 04001 Košice-Staré Mesto',
      url: 'https://www.google.com/maps/search/?api=1&query=48.722419,21.252767',
      phone: '+421 917600777, +421 940655677',
      email: null,
      additionalInfo:
        'Vzdialenosť: 0.6 km · Ordinačné hodiny: Po 7:30 - 15:30; Ut 7:30 - 15:30; St 7:30 - 15:30; Št 7:30 - 15:30; Pi 7:30 - 13:00' +
        ' · Poisťovne: VšZP, Dôvera, Union',
    });
  });
});

describe('facilityResult', () => {
  it('gives the model a short text and the user the list', () => {
    const many = Array.from({ length: 25 }, (_, i) => at(`Clinic ${i}`, 'Michalovce', 'Michalovce'));
    const [content, artifact] = facilityResult(many, { what: 'Neurológ', town: 'Michalovce', speciality: 'Neurológ' }, config);
    expect(content.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(8);
    expect(content).toContain('(more than shown here)');
    expect(content).not.toMatch(/\b25\b/); // no count for the model to repeat
    expect(artifact?.doctors).toHaveLength(20);
  });

  it('says so when nothing was found', () => {
    const [content, artifact] = facilityResult([], { what: 'Neurológ', town: 'Biel', speciality: 'Neurológ' }, config);
    expect(content).toContain('no facilities');
    expect(artifact).toBeUndefined();
  });
});

describe('with a fake find_medical_facility tool', () => {
  type FacilityTool = ReturnType<typeof createFindMedicalFacilityTool>;
  const records = [
    at('Všeobecná ambulancia pre dospelých, MUDr. A', 'Košice - mestská časť Staré Mesto', 'Košice I'),
    at('Všeobecná ambulancia pre deti a dorast, MUDr. B', 'Košice - mestská časť Staré Mesto', 'Košice I'),
    at('Všeobecná ambulancia pre dospelých, MUDr. C', 'Košice - mestská časť Západ', 'Košice II'),
  ];
  const fakeTool = (result: unknown) =>
    ({
      name: 'find_medical_facility',
      description: 'fake',
      schema: {},
      invoke: vi.fn(async () => result),
    }) as unknown as FacilityTool & { invoke: ReturnType<typeof vi.fn> };

  it('planSearch: right query, adults only, exact town', async () => {
    const facilityTool = fakeTool(records);
    const [, artifact] = await searchFacilities(
      facilityTool,
      { speciality: 'Všeobecný lekár', town: 'Košice I', queries: config.facilityTypes['Všeobecný lekár'] },
      config,
    );
    expect(facilityTool.invoke).toHaveBeenCalledWith({
      query: 'ambulancia všeobecnej ambulantnej zdravotnej starostlivosti',
      county_filter: 'Košice I',
    });
    expect(artifact?.doctors.map((d) => d.name)).toEqual(['Všeobecná ambulancia pre dospelých, MUDr. A']);
  });

  it('model call: short text instead of the raw JSON', async () => {
    const wrapped = createFacilityToolForModel(fakeTool(records), config);
    const content = await wrapped.invoke({ query: 'všeobecn', county_filter: 'Košice II' });
    expect(String(content)).toContain('1. Všeobecná ambulancia pre dospelých, MUDr. C');
    expect(String(content)).not.toContain('"properties"');
  });
});

describe('user location', () => {
  type FacilityTool = ReturnType<typeof createFindMedicalFacilityTool>;
  const near = (name: string, km: number): Facility => ({
    geometry: null,
    properties: {
      nazov_zariadenia: name,
      addressline: `${name} street`,
      municipality: 'Košice - mestská časť Staré Mesto',
      county: 'Košice I',
      distance_to_home_km: km,
    },
  });
  const toolReturning = (records: Facility[]) =>
    ({ name: 'find_medical_facility', description: 'fake', schema: {}, invoke: vi.fn(async () => records) }) as unknown as
      FacilityTool & { invoke: ReturnType<typeof vi.fn> };
  const home = { lat: 48.7203, lon: 21.2575 };

  it('no town: searches around the user and shows the nearest first, with distance', async () => {
    const facilityTool = toolReturning([near('Far', 7.42), near('Close', 0.55)]);
    const [content, artifact] = await searchFacilities(
      facilityTool,
      { speciality: 'Neurológ', queries: [{ query: 'neurologická ambulancia' }], location: home, radiusKm: 10 },
      config,
    );
    expect(facilityTool.invoke).toHaveBeenCalledWith({
      query: 'neurologická ambulancia',
      user_latitude: 48.7203,
      user_longitude: 21.2575,
      radius: 10,
    });
    expect(artifact?.doctors.map((d) => d.name)).toEqual(['Close', 'Far']);
    expect(artifact?.doctors[0].additionalInfo).toContain('Vzdialenosť: 0.6 km');
    expect(content).toContain('in the area within 10 km of the user');
    expect(content).toContain('Close — Close street (0.6 km from the user)');
  });

  it('with a town: no radius, only the distance', async () => {
    const facilityTool = toolReturning([near('A', 1)]);
    await searchFacilities(
      facilityTool,
      { speciality: 'Neurológ', town: 'Košice I', queries: [{ query: 'neurologická ambulancia' }], location: home, radiusKm: 10 },
      config,
    );
    expect(facilityTool.invoke).toHaveBeenCalledWith({
      query: 'neurologická ambulancia',
      county_filter: 'Košice I',
      user_latitude: 48.7203,
      user_longitude: 21.2575,
    });
  });
});

describe('town vs county', () => {
  const michalovce = at('M', 'Michalovce', 'Michalovce');
  const strazske = at('S', 'Strážske', 'Michalovce');

  it('a town search keeps only the town, a county keeps the whole okres', () => {
    expect(inTown([michalovce, strazske], 'Michalovce')).toEqual([michalovce]);
    expect(inCounty([michalovce, strazske], 'Michalovce')).toEqual([michalovce, strazske]);
  });
});
