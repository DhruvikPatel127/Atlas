const subjectsData = {
  backgrounds: [
    {
      id: 'engineering',
      name: 'Engineering',
      branches: [
        { id: 'cs', name: 'Computer Science', subjects: ['Data Structures', 'Algorithms', 'Operating Systems', 'Database Management', 'Computer Networks'] },
        { id: 'mechanical', name: 'Mechanical Engineering', subjects: ['Thermodynamics', 'Fluid Mechanics', 'Machine Design', 'Manufacturing Processes', 'Heat Transfer'] },
        { id: 'electrical', name: 'Electrical Engineering', subjects: ['Circuit Theory', 'Control Systems', 'Power Systems', 'Electrical Machines', 'Digital Electronics'] },
        { id: 'civil', name: 'Civil Engineering', subjects: ['Structural Analysis', 'Geotechnical Engineering', 'Fluid Mechanics', 'Surveying', 'Transportation Engineering'] }
      ]
    },
    {
      id: 'medical',
      name: 'Medical',
      branches: [
        { id: 'mbbs', name: 'MBBS', subjects: ['Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology'] },
        { id: 'dental', name: 'Dental (BDS)', subjects: ['Dental Anatomy', 'Oral Pathology', 'Periodontics', 'Orthodontics', 'Oral Surgery'] }
      ]
    },
    {
      id: 'commerce',
      name: 'Commerce',
      branches: [
        { id: 'accounting', name: 'Accounting', subjects: ['Financial Accounting', 'Cost Accounting', 'Corporate Accounting', 'Auditing', 'Taxation'] },
        { id: 'business', name: 'Business Management', subjects: ['Principles of Management', 'Marketing Management', 'Human Resource Management', 'Business Ethics', 'Strategic Management'] }
      ]
    },
    {
      id: 'science_high',
      name: 'Science (High School)',
      branches: [
        { id: 'pcm', name: 'Physics, Chemistry, Math', subjects: ['Physics', 'Chemistry', 'Mathematics', 'English', 'Computer Science'] },
        { id: 'pcb', name: 'Physics, Chemistry, Biology', subjects: ['Physics', 'Chemistry', 'Biology', 'English', 'Psychology'] }
      ]
    },
    {
      id: 'competitive_exams',
      name: 'Competitive Exams',
      branches: [
        { id: 'jee', name: 'JEE (Main & Advanced)', subjects: ['Physics', 'Chemistry', 'Mathematics'] },
        { id: 'neet', name: 'NEET', subjects: ['Physics', 'Chemistry', 'Biology (Botany & Zoology)'] },
        { id: 'upsc', name: 'UPSC Civil Services', subjects: ['History', 'Geography', 'Polity', 'Economics', 'General Science', 'Current Affairs'] },
        { id: 'gate', name: 'GATE', subjects: ['Engineering Mathematics', 'General Aptitude', 'Technical Subjects'] }
      ]
    }
  ]
};

module.exports = subjectsData;
