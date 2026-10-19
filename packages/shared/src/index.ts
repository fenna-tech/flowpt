export interface Patient {
  id: string
  firstName: string
  lastName: string
  dob: string // YYYY-MM-DD
  phn: string // BC Personal Health Number (10 digits, optional)
  email: string
  phone: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type PatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>

export interface PatientApi {
  list(search?: string): Promise<Patient[]>
  get(id: string): Promise<Patient | null>
  create(input: PatientInput): Promise<Patient>
  update(id: string, input: PatientInput): Promise<Patient>
  remove(id: string): Promise<void>
}
