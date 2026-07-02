export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  website?: string;
}

export interface Education {
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface Experience {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  location?: string;
  description: string[];
}

export interface Skill {
  name: string;
  category?: string;
}

export interface Language {
  name: string;
  level: string;
}

export interface Certification {
  name: string;
  issuer: string;
  date: string;
}

export interface CareerMemory {
  id?: string;

  personalInfo: PersonalInfo;

  summary: string;

  targetRoles: string[];

  education: Education[];

  experience: Experience[];

  skills: Skill[];

  languages: Language[];

  certifications: Certification[];

  createdAt?: string;

  updatedAt?: string;
}