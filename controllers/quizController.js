const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');
const Note = require('../models/Note');
const User = require('../models/User');
const { generateContent } = require('./geminiController');

const generateQuiz = async (req, res) => {
  try {
    const { noteId } = req.body;
    
    // Validate noteId
    if (!noteId || !/^[0-9a-fA-F]{24}$/.test(noteId)) {
      return res.status(400).json({ message: 'A valid Note ID is required to generate a quiz' });
    }

    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const prompt = `Based on the following notes, generate a quiz with 5 multiple-choice questions. 
    Return the response in JSON format like this:
    {
      "title": "Quiz Title",
      "questions": [
        {
          "question": "Question text?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A"
        }
      ]
    }
    Notes: ${note.content}`;

    const aiResponse = await generateContent(prompt, 'quiz');
    
    // Clean up the response (Gemini sometimes adds markdown backticks or extra text)
    let cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();
    
    // Attempt to find the first '{' and last '}' to handle cases where AI adds preamble/postamble
    const firstBrace = cleanedResponse.indexOf('{');
    const lastBrace = cleanedResponse.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
    }

    let quizData;
    try {
      quizData = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('JSON Parse Error in generateQuiz:', parseError.message);
      console.log('Cleaned Response that failed:', cleanedResponse);
      return res.status(500).json({ 
        message: 'AI generated invalid JSON. Please try again.', 
        error: parseError.message 
      });
    }

    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    // Increment AI usage counter
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
    const { quizId, score } = req.body;
    const userId = req.user.id || req.user._id;

    if (!quizId) {
      return res.status(400).json({ message: 'Quiz ID is required' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const quizObjectId = new mongoose.Types.ObjectId(quizId);

    console.log(`Submitting score for quiz ${quizId}: ${score} (User: ${userId})`);

    // Use returnDocument: 'after' instead of new: true to avoid deprecation warning
    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizObjectId, userId: userObjectId },
      { $set: { score: Number(score) } },
      { returnDocument: 'after' }
    );

    if (!quiz) {
      console.log(`Quiz not found or unauthorized: ${quizId} for User: ${userId}`);
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    console.log(`Score saved successfully for quiz ${quizId}. New score in DB: ${quiz.score}`);
    res.json({ success: true, quiz });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ message: 'Error saving score', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log('--- STATS CALCULATION START ---');
    console.log('User ID from Request:', userId);

    // Mongoose handles string to ObjectId casting automatically for .find()
    // but we'll fetch using the userId string first, then try ObjectId if nothing found
    let allUserQuizzes = await Quiz.find({ userId: userId }).sort({ createdAt: -1 });
    
    if (allUserQuizzes.length === 0 && mongoose.Types.ObjectId.isValid(userId)) {
      console.log('No quizzes found with string ID, trying ObjectId conversion...');
      allUserQuizzes = await Quiz.find({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
    }

    console.log(`Final count: Found ${allUserQuizzes.length} quizzes for user.`);

    // Filter for quizzes that have a score
    const scoredQuizzes = allUserQuizzes.filter(q => q.score !== null && q.score !== undefined);
    console.log(`Found ${scoredQuizzes.length} scored quizzes.`);

    let totalQuestionsAnswered = 0;
    let totalCorrectAnswers = 0;
    const subjectStats = {};

    scoredQuizzes.forEach(quiz => {
      const score = Number(quiz.score) || 0;
      let total = Number(quiz.totalQuestions);
      if (!total || total === 0) {
        total = (quiz.questions && quiz.questions.length > 0) ? quiz.questions.length : 5;
      }

      totalQuestionsAnswered += total;
      totalCorrectAnswers += score;

      const subject = quiz.subject || 'General';
      if (!subjectStats[subject]) {
        subjectStats[subject] = { score: 0, total: 0 };
      }
      subjectStats[subject].score += score;
      subjectStats[subject].total += total;
    });

    const averageScore = totalQuestionsAnswered > 0 
      ? Math.round((totalCorrectAnswers / totalQuestionsAnswered) * 100) 
      : 0;

    const uniqueDates = [...new Set(
      scoredQuizzes
        .filter(q => q.createdAt)
        .map(q => new Date(q.createdAt).toDateString())
    )];

    let currentStreak = 0;
    if (uniqueDates.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastQuizDate = new Date(uniqueDates[0]);
      lastQuizDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(Math.abs(today - lastQuizDate) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        currentStreak = 1;
        for (let i = 0; i < uniqueDates.length - 1; i++) {
          const d1 = new Date(uniqueDates[i]); d1.setHours(0,0,0,0);
          const d2 = new Date(uniqueDates[i+1]); d2.setHours(0,0,0,0);
          const gap = Math.floor(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
          if (gap === 1) currentStreak++;
          else break;
        }
      }
    }

    const subjectAccuracy = Object.keys(subjectStats).map(subject => ({
      subject: subject,
      accuracy: Math.round((subjectStats[subject].score / subjectStats[subject].total) * 100)
    }));

    const stats = {
      totalQuestionsAnswered: scoredQuizzes.length, 
      averageScore: averageScore,
      streak: currentStreak,
      subjectAccuracy: subjectAccuracy,
      totalQuizzesFound: allUserQuizzes.length // Extra info for debugging
    };

    console.log('Calculated Stats:', stats);
    console.log('--- STATS CALCULATION END ---');

    res.json(stats);
  } catch (error) {
    console.error('Stats calculation error:', error);
    res.status(500).json({ message: 'Error calculating stats', error: error.message });
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
