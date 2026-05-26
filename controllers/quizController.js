const Quiz = require('../models/Quiz');
const Note = require('../models/Note');
const { generateContent } = require('./aiController');

const generateQuiz = async (req, res) => {
  try {
    const { noteId, type = 'mixed' } = req.body;
    
    // Validate noteId
    if (!noteId || !/^[0-9a-fA-F]{24}$/.test(noteId)) {
      return res.status(400).json({ message: 'A valid Note ID is required to generate a quiz' });
    }

    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    let typeInstruction = '';
    if (type === 'mcq') {
      typeInstruction = '5 multiple-choice questions';
    } else if (type === 'tf') {
      typeInstruction = '5 true/false questions';
    } else if (type === 'fill') {
      typeInstruction = '5 fill-in-the-blanks questions';
    } else {
      typeInstruction = 'a mix of 5 questions (MCQ, True/False, and Fill-in-the-blanks)';
    }

    const prompt = `Based on the following notes, generate a quiz with ${typeInstruction}. 
    Return the response in JSON format like this:
    {
      "title": "Quiz Title",
      "questions": [
        {
          "question": "Question text?",
          "options": ["Option A", "Option B", "Option C", "Option D"], // Leave empty or null for T/F and Fill-in-the-blanks
          "correctAnswer": "Option A",
          "type": "mcq" // "mcq", "tf", or "fill"
        }
      ]
    }
    Notes: ${note.content}`;

    const aiResponse = await generateContent(prompt, 'quiz');
    
    // Clean up the response
    const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();
    const quizData = JSON.parse(cleanedResponse);

    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    // Increment AI usage counter
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, { $inc: { ai_questions_today: 1 } });

    const newQuiz = new Quiz({
      userId: userId,
      noteId: noteId,
      title: note.title,
      subject: note.subject || 'General',
      questions: quizData.questions,
      totalQuestions: quizData.questions.length
    });

    await newQuiz.save();
    res.status(201).json(newQuiz);
  } catch (error) {
    console.error('Quiz generation error:', error);
    res.status(500).json({ message: 'Error generating quiz', error: error.message });
  }
};

const submitQuizScore = async (req, res) => {
  try {
    const { quizId, score, answers } = req.body; // answers: [{ questionId, userAnswer, isCorrect, topic }]
    const userId = req.user.id || req.user._id;

    const quiz = await Quiz.findOne({ _id: quizId, userId: userId });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // Update quiz with user answers
    quiz.score = score;
    if (answers && answers.length > 0) {
      answers.forEach(ans => {
        const q = quiz.questions.id(ans.questionId);
        if (q) {
          q.userAnswer = ans.userAnswer;
          q.isCorrect = ans.isCorrect;
          q.topic = ans.topic || 'General';
        }
      });
    }
    await quiz.save();

    // Gamification & Weakness Logic
    const user = await User.findById(userId);
    
    // 1. XP (10 XP per correct answer)
    const xpEarned = score * 10;
    user.xp += xpEarned;
    user.level = Math.floor(user.xp / 1000) + 1;

    // 2. Streak Logic
    const today = new Date().setHours(0,0,0,0);
    const lastActivity = user.last_activity_date ? new Date(user.last_activity_date).setHours(0,0,0,0) : null;
    
    if (!lastActivity || today > lastActivity) {
      if (lastActivity && today === lastActivity + 86400000) {
        user.streak += 1;
      } else if (!lastActivity || today > lastActivity + 86400000) {
        user.streak = 1;
      }
      user.last_activity_date = new Date();
    }

    // 3. Weakness Detector
    if (answers) {
      answers.forEach(ans => {
        if (!ans.isCorrect && ans.topic) {
          const currentCount = user.weak_topics.get(ans.topic) || 0;
          user.weak_topics.set(ans.topic, currentCount + 1);
        }
      });
    }

    await user.save();
    
    res.json({ 
      success: true, 
      quiz, 
      xpEarned, 
      newStreak: user.streak, 
      level: user.level,
      weakTopics: Array.from(user.weak_topics.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    });
  } catch (error) {
    console.error('Submit score error:', error);
    res.status(500).json({ message: 'Error saving score', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    
    // 1. Total Quizzes and Average Score
    const quizzes = await Quiz.find({ userId: userId, score: { $exists: true } });
    const totalQuizzes = quizzes.length;
    const avgScore = totalQuizzes > 0 
      ? (quizzes.reduce((acc, q) => acc + (q.score / q.totalQuestions), 0) / totalQuizzes) * 100 
      : 0;

    // 2. Subject Accuracy
    const subjects = await Quiz.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), score: { $exists: true } } },
      { 
        $group: { 
          _id: "$subject", 
          avgAccuracy: { $avg: { $divide: ["$score", "$totalQuestions"] } } 
        } 
      }
    ]);

    // 3. Top Weak Topics
    const weakTopics = Array.from(user.weak_topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, mistakes: count }));

    res.json({
      totalQuestionsAnswered: quizzes.reduce((acc, q) => acc + q.totalQuestions, 0),
      averageScore: Math.round(avgScore),
      streak: user.streak,
      xp: user.xp,
      level: user.level,
      weakTopics: weakTopics,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id,
        accuracy: Math.round(s.avgAccuracy * 100)
      }))
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
};

const getQuizzesByNoteId = async (req, res) => {
  try {
    const quizzes = await Quiz.find({ noteId: req.params.noteId, userId: req.user.id });
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching quizzes', error: error.message });
  }
};

module.exports = {
  generateQuiz,
  submitQuizScore,
  getUserStats,
  getQuizzesByNoteId,
};
