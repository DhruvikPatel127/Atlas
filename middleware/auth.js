const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_atlas_app_2026';
    const decoded = jwt.verify(token, secret);
    
    // Ensure both id and _id are available for convenience
    req.user = decoded.user;
    if (req.user.id && !req.user._id) req.user._id = req.user.id;
    if (req.user._id && !req.user.id) req.user.id = req.user._id;
    
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = auth;
