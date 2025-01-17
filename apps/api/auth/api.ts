import { IUser, IUserWithID, User } from '@tipovacka/models';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import passport from 'passport';
import { infoAuditLog, isLoggedIn, warnAuditLog } from '../utils/authMiddleware';
import { ResponseErrorCodes, ResponseMessages } from '../utils/httpResponses';
import logger from '../utils/logger';

const router = Router();

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  infoAuditLog(req);

  const user = req.user as IUserWithID | undefined;

  if (!isLoggedIn(req)) {
    warnAuditLog(req, user);
    return res.status(401).json({
      message: ResponseMessages.UNAUTHORIZED_REQUEST,
      code: ResponseErrorCodes.UNAUTHORIZED_REQUEST,
    });
  }

  return next();
};

router.get('/user', (req, res) => {
  logger.info(`[${req.method}] ${req.baseUrl}${req.path} from ${req.ip}.`);
  const user = req.user;

  // For some reason, when submiting a bet in production, the requests arrive
  // with the scorer field as a string. E.g., instead 256, the value is "256".
  // This is a quick workaround to make sure we always return back scorers
  // as numbers, until the root problem is fixed.
  if (user) {
    const user = req.user as IUser;
    user.bets = user.bets.map((bet) => {
      if (typeof bet.scorer === 'string') {
        bet.scorer = parseInt(bet.scorer);
      }
      return bet;
    });
  }

  res.status(200).send(user);
});

router.get('/logout', (req, res) => {
  logger.info(`[${req.method}] ${req.baseUrl}${req.path} from ${req.ip}.`);
  req.session?.destroy(async (err) => {
    if (err) {
      logger.warn(
        `Couldn't destory session ${req.sessionID} for a user ${req.user}. Error: ${err}`
      );
    }

    if (process.env.NODE_ENV === 'production') {
      const Sessions = mongoose.connection.collection('sessions');
      await Sessions.findOneAndDelete({ _id: new mongoose.Types.ObjectId(req.sessionID) }).catch(
        (err) => {
          logger.warn(`Couldn't delete sessions ${req.sessionID} from the database. Error: ${err}`);
        }
      );
    }
  });
  req.logout();
  res.status(200).send();
});

router.post('/login', passport.authenticate('local'), function (req, res) {
  logger.info(`[${req.method}] ${req.baseUrl}${req.path} from ${req.ip}.`);
  // If this function gets called, authentication was successful.
  // `req.user` contains the authenticated user.
  res.status(200).send('Login successfull.');
});

router.post('/password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword, confirmedPassword } = req.body;

  if (!oldPassword || !newPassword || !confirmedPassword) {
    res.status(400).json({
      message: ResponseMessages.REQUIRED_ATTRIBUTES_MISSING,
      code: ResponseErrorCodes.INVALID_REQUEST_BODY,
    });
    return;
  }

  if (newPassword !== confirmedPassword) {
    res.status(400).json({
      message: ResponseMessages.PASSWORDS_DONT_MATCH,
      code: ResponseErrorCodes.INVALID_REQUEST_BODY,
    });
    return;
  }

  try {
    const user = await User.findById((req.user as IUserWithID)._id);

    if (!user) {
      return res.status(404).send("User doesn't exist");
    }

    const passwordsMatch = await bcrypt.compare(oldPassword, user.password!);
    if (!passwordsMatch) {
      res.status(401).json({
        message: ResponseMessages.UNAUTHORIZED_REQUEST,
        code: ResponseErrorCodes.UNAUTHORIZED_REQUEST,
      });
      return;
    }

    const salt = await bcrypt.genSalt();
    const newEncryptedPassword = await bcrypt.hash(newPassword, salt);
    user.password = newEncryptedPassword;
    await user.save();

    logger.info(`Password for a user ${user.email} (${user._id}) was changed.`);

    res.status(200).send();
  } catch (error) {
    res.status(500).send({
      message: ResponseMessages.INTERNAL_SERVER_ERROR,
      code: ResponseErrorCodes.INTERNAL_SERVER_ERROR,
    });
  }
});

export default router;
