import type { CareerMemoryPreviewData } from "@/components/resume/CareerMemoryTemplatePreview";

/*
  PoC-only fixtures. Not real user/production data - hand-written sample
  content used to test the Section Parser (lib/brand/sectionParser.ts)
  against a few different resume-writing conventions AI output could
  plausibly use, and to compare the result against
  CareerMemoryTemplatePreview fed with an equivalent structured object
  (same underlying content, entered as fields instead of a flat string).

  Sample 1: clean/typical case (blank-line-separated entries, one date
  range per header line).
  Sample 2: alternate heading vocabulary + "Title, Company | dates" on a
  single line.
  Sample 3: deliberately messy - the whole Experience section is written
  as flowing prose with no per-role blank-line separation, to produce an
  honest, expected experience-parser failure case for the report.
*/

export type ResumeFixture = {
  id: string;
  label: string;
  resumeText: string;
  header: { name: string; contact: string };
  referenceData: Omit<
    CareerMemoryPreviewData,
    "resumeTemplate" | "themeColor" | "font" | "textSize"
  >;
};

const sample1: ResumeFixture = {
  id: "sample1",
  label: "Sample 1 — Clean formatting",
  header: {
    name: "Jordan Lee",
    contact: "Toronto, ON | jordan.lee@email.com | (416) 555-0182 | linkedin.com/in/jordanlee",
  },
  resumeText: `Jordan Lee
Toronto, ON | jordan.lee@email.com | (416) 555-0182 | linkedin.com/in/jordanlee

Professional Summary

Results-driven Frontend Engineer with 5+ years of experience building scalable web applications using React and TypeScript. Proven track record of improving application performance and mentoring junior developers.

Skills

React, TypeScript, Next.js, GraphQL, Jest, CSS/Tailwind, Node.js, Git, Agile/Scrum

Experience

Senior Frontend Engineer
Acme Software Inc. — Jan 2021 - Present
- Led migration of legacy Angular app to React, reducing page load time by 40%
- Mentored 3 junior engineers through a structured onboarding program
- Built a component library used across 6 product teams

Frontend Developer
BrightPath Technologies — Jun 2018 - Dec 2020
- Implemented responsive UI components for the customer dashboard
- Collaborated with design team to establish a shared design system

Education

Bachelor of Science in Computer Science
University of Toronto — 2014 - 2018

Certifications

AWS Certified Developer – Associate, Amazon Web Services, 2022

Languages

English - Native
French - Conversational`,
  referenceData: {
    firstName: "Jordan",
    lastName: "Lee",
    email: "jordan.lee@email.com",
    phone: "(416) 555-0182",
    location: "Toronto, ON",
    linkedin: "linkedin.com/in/jordanlee",
    headline: "",
    summary:
      "Results-driven Frontend Engineer with 5+ years of experience building scalable web applications using React and TypeScript. Proven track record of improving application performance and mentoring junior developers.",
    skills: "React, TypeScript, Next.js, GraphQL, Jest, CSS/Tailwind, Node.js, Git, Agile/Scrum",
    workExperience: [
      {
        company: "Acme Software Inc.",
        jobTitle: "Senior Frontend Engineer",
        startDate: "2021-01",
        endDate: "",
        isCurrent: true,
        description:
          "Led migration of legacy Angular app to React, reducing page load time by 40%\nMentored 3 junior engineers through a structured onboarding program\nBuilt a component library used across 6 product teams",
      },
      {
        company: "BrightPath Technologies",
        jobTitle: "Frontend Developer",
        startDate: "2018-06",
        endDate: "2020-12",
        isCurrent: false,
        description:
          "Implemented responsive UI components for the customer dashboard\nCollaborated with design team to establish a shared design system",
      },
    ],
    volunteerExperience: [],
    education: [
      {
        school: "University of Toronto",
        program: "Bachelor of Science in Computer Science",
        startDate: "2014-09",
        endDate: "2018-06",
        gpa: "",
        coursework: "",
      },
    ],
    languages: [
      { language: "English", level: "Native" },
      { language: "French", level: "Conversational" },
    ],
    certifications: [
      { name: "AWS Certified Developer – Associate", issuer: "Amazon Web Services", date: "2022" },
    ],
    projects: [],
  },
};

const sample2: ResumeFixture = {
  id: "sample2",
  label: "Sample 2 — Alternate headings, one-line entries",
  header: {
    name: "Priya Nandakumar",
    contact: "Vancouver, BC | priya.n@email.com | (604) 555-0199",
  },
  resumeText: `Priya Nandakumar
Vancouver, BC | priya.n@email.com | (604) 555-0199

SUMMARY

Marketing coordinator with a strong background in digital campaigns and content strategy across B2B and B2C sectors.

WORK EXPERIENCE

Marketing Coordinator
Northwind Retail Group — Mar 2019 - Present
- Managed social media campaigns across 4 platforms, growing follower base by 65%
- Coordinated with external agencies on brand refresh initiative

Marketing Assistant
Coastal Media Co. — Aug 2016 - Feb 2019
- Assisted in planning quarterly email marketing campaigns
- Analyzed campaign performance data and prepared monthly reports

EDUCATION

Bachelor of Business Administration, Marketing
Simon Fraser University — 2012 - 2016

TECHNICAL SKILLS

Google Analytics, Hootsuite, Mailchimp, Adobe Creative Suite, SEO/SEM

VOLUNTEER EXPERIENCE

Event Volunteer
Vancouver Community Food Bank
- Assisted with logistics for monthly food distribution events`,
  referenceData: {
    firstName: "Priya",
    lastName: "Nandakumar",
    email: "priya.n@email.com",
    phone: "(604) 555-0199",
    location: "Vancouver, BC",
    linkedin: "",
    headline: "",
    summary:
      "Marketing coordinator with a strong background in digital campaigns and content strategy across B2B and B2C sectors.",
    skills: "Google Analytics, Hootsuite, Mailchimp, Adobe Creative Suite, SEO/SEM",
    workExperience: [
      {
        company: "Northwind Retail Group",
        jobTitle: "Marketing Coordinator",
        startDate: "2019-03",
        endDate: "",
        isCurrent: true,
        description:
          "Managed social media campaigns across 4 platforms, growing follower base by 65%\nCoordinated with external agencies on brand refresh initiative",
      },
      {
        company: "Coastal Media Co.",
        jobTitle: "Marketing Assistant",
        startDate: "2016-08",
        endDate: "2019-02",
        isCurrent: false,
        description:
          "Assisted in planning quarterly email marketing campaigns\nAnalyzed campaign performance data and prepared monthly reports",
      },
    ],
    volunteerExperience: [
      {
        organization: "Vancouver Community Food Bank",
        role: "Event Volunteer",
        startDate: "",
        endDate: "",
        isCurrent: false,
        description: "Assisted with logistics for monthly food distribution events",
      },
    ],
    education: [
      {
        school: "Simon Fraser University",
        program: "Bachelor of Business Administration, Marketing",
        startDate: "2012-09",
        endDate: "2016-06",
        gpa: "",
        coursework: "",
      },
    ],
    languages: [],
    certifications: [],
    projects: [],
  },
};

const sample3: ResumeFixture = {
  id: "sample3",
  label: "Sample 3 — Messy, flowing Experience (stress test)",
  header: {
    name: "Alex Chen",
    contact: "alex.chen88@email.com | 647-555-0134",
  },
  resumeText: `Alex Chen
alex.chen88@email.com | 647-555-0134

I am a dedicated project manager with over eight years of experience leading cross-functional teams in the construction and engineering sectors, known for delivering projects on time and under budget.

Experience

Since 2019 I have worked as a Senior Project Manager at Horizon Builders, where I have overseen more than $40M in commercial construction projects, coordinated with architects, engineers, and city inspectors, and implemented a new scheduling system that cut delays by 20%. Prior to that, from 2015 to 2019, I was a Project Coordinator at Falcon Construction Group, supporting senior PMs on residential developments and managing subcontractor relationships.

Education

Diploma in Construction Management, George Brown College, 2014

Skills

Project scheduling, budgeting, stakeholder communication, risk management, Procore, MS Project`,
  referenceData: {
    firstName: "Alex",
    lastName: "Chen",
    email: "alex.chen88@email.com",
    phone: "647-555-0134",
    location: "",
    linkedin: "",
    headline: "",
    summary:
      "Dedicated project manager with over eight years of experience leading cross-functional teams in the construction and engineering sectors, known for delivering projects on time and under budget.",
    skills: "Project scheduling, budgeting, stakeholder communication, risk management, Procore, MS Project",
    workExperience: [
      {
        company: "Horizon Builders",
        jobTitle: "Senior Project Manager",
        startDate: "2019-01",
        endDate: "",
        isCurrent: true,
        description:
          "Overseen more than $40M in commercial construction projects\nCoordinated with architects, engineers, and city inspectors\nImplemented a new scheduling system that cut delays by 20%",
      },
      {
        company: "Falcon Construction Group",
        jobTitle: "Project Coordinator",
        startDate: "2015-01",
        endDate: "2019-01",
        isCurrent: false,
        description:
          "Supported senior PMs on residential developments\nManaged subcontractor relationships",
      },
    ],
    volunteerExperience: [],
    education: [
      {
        school: "George Brown College",
        program: "Diploma in Construction Management",
        startDate: "",
        endDate: "2014-06",
        gpa: "",
        coursework: "",
      },
    ],
    languages: [],
    certifications: [],
    projects: [],
  },
};

export const SAMPLE_RESUMES: ResumeFixture[] = [sample1, sample2, sample3];
