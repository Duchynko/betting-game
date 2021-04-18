import { Game, Group, IGame, IGroup, IUser, User } from '@duchynko/tipovacka-models';
import { NextFunction, Request, Response, Router } from 'express';
import { isAdmin } from '../utils/authMiddleware';
import * as FootballApi from '../utils/footballApi';
import { findUpcomingGame } from '../utils/games';
import { getLatestSeason, mapStandings, mapTeamStatistics } from '../utils/groups';
import logger from '../utils/logger';

const router = Router();

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  logger.info(`[${req.method}] ${req.baseUrl}${req.path} from ${req.ip}.`);

  // If req.headers contains the admin key, continue
  if (isAdmin(req)) {
    next();
    return;
  }

  logger.warn(
    `[${req.originalUrl}] Unauthorized request was made by user ${
      req.user && (req.user as IUser & { _id: string })._id
    } from IP: ${req.ip}. The provided ADMIN_API_TOKEN was ${req.header(
      'tipovacka-auth-token'
    )}`
  );
  res.status(401).send('Unauthorized request');
};

/**
 * @warning This endpoint is not fully implemented!
 * @note This endpoint should be used only for testing!
 *
 * Manually fetch upcoming games for a specified group.
 *
 * Access: ADMIN
 *
 * @param group an ObjectId of the group for which upcoming games should be fetched
 * @param team an API ID of the followed team for which upcoming games should be fetched
 * @param amount number of upcoming games that should be fetched (e.g., next 3 games of the team)
 */
router.get('/groups/team/upcoming', authMiddleware, async (req, res) => {
  const groupId: string = req.body.group;
  const teamId: number = req.body.team;
  const amountOfGames: number = req.body.amount;

  try {
    // const group = await Group.findById(groupId).populate('upcomingGames');
    // if (!group) {
    //   throw new Error(`Group with id ${groupId} doesn't exist.`);
    // }

    // const team = group.followedTeams.find((t) => t.apiId === teamId);
    // if (!team) {
    //   throw new Error(
    //     `The group ${group.name} doesn't follow a team with the API id ${teamId}.`
    //   );
    // }

    // const latestSeason = getLatestSeason(team);
    // const competitionIds = latestSeason.competitions.map((c) => c.apiId);

    // // TODO: Update findUpcomingGame to fetch specific number of upcoming games.
    // const newUpcomingGame = await findUpcomingGame(teamId, competitionIds);

    res.status(500).json('Endpoint not implemented.');
  } catch (error) {
    res.status(400).json(error.message);
  }
});

/**
 * Create a new user in a specified group.
 *
 * Access: ADMIN
 *
 * @param username username of the newly created user
 * @param email email of the newly created user
 * @param password password of the newly created user
 * @param group ObjectId of the group the user will be part of
 */
router.post('/users', authMiddleware, async (req, res) => {
  const { username, email, password } = req.body;
  const groupId = req.body.group;

  try {
    logger.info(`Fetching the group ${groupId}.`);
    const group = await Group.findById(groupId);
    if (!group) {
      logger.warn(`Group with _id ${groupId} doesn't exist.`);
      res.status(404).json("Selected group doesn't exist.");
      return;
    }

    logger.info('Creating a new user.');
    const user = await User.create<IUser>({
      username: username,
      email: email,
      password: password,
      groupId: groupId,
    });
    logger.info('New user created successfully.');
    logger.info(JSON.stringify(user));

    res.status(200).json(user);
  } catch (error) {
    logger.error(`There was an error creting the user. Error: ${error}.`);
    res.status(500).json('Internal server error');
  }
});

/**
 * Create a new group, populate a specified competition object
 * with standings and team statistics fetched from the Football API.
 *
 * Access: ADMIN
 *
 * @param name name of the new group
 * @param email email of the new group
 * @param website website of the new group
 * @param team API id of the team that will be initialized as the followedTeam
 * @param league API id of the league for which standings and team statistics will be fetched
 * @param season year of the season for which competition standings and team statistics will be fetched
 *
 */
router.post('/groups', authMiddleware, async ({ body }, res) => {
  try {
    logger.info('Fetching team information from the API.');
    const teamResponse = await FootballApi.getTeam({
      id: body.team,
      league: body.league,
      season: body.season,
    });
    logger.info(JSON.stringify(teamResponse.data));

    if (teamResponse.data.results === 0) {
      logger.error(
        'The team response object contains 0 results. Make sure that the request ' +
          'body contains correct values.'
      );
      return res
        .status(404)
        .json(
          'Team information not found. Make sure the request body contains correct values.'
        );
    }

    logger.info('Fetching team statistics from the API.');
    const statisticsResponse = await FootballApi.getTeamStatistics({
      team: body.team,
      season: body.season,
      league: body.league,
    });
    logger.info(JSON.stringify(statisticsResponse.data));

    if (statisticsResponse.data.results === 0) {
      logger.error(
        'The team statistics response object contains 0 results. Make sure that the ' +
          'request body contains correct values.'
      );
      return res
        .status(404)
        .json(
          'Team statistics not found. Make sure the request body contains correct values.'
        );
    }

    logger.info('Fetching competition standings from the API.');
    const competitionResponse = await FootballApi.getStandings({
      league: body.league,
      season: body.season,
    });
    logger.info(JSON.stringify(competitionResponse.data));

    if (competitionResponse.data.results === 0) {
      logger.error(
        'The competition standings response object contains 0 results. Make sure that the ' +
          'request body contains correct values.'
      );
      return res
        .status(404)
        .json(
          'Team competition standings not found. Make sure the request body contains correct values.'
        );
    }

    const { team, venue } = teamResponse.data.response[0];
    const competition = competitionResponse.data.response[0];
    const teamStatistics = statisticsResponse.data.response;

    logger.info(
      'Data fetched successfully. Creating a new group document in the database.'
    );
    const group = await Group.create<IGroup>({
      name: body.name,
      email: body.email,
      website: body.website,
      upcomingGames: [],
      users: [],
      followedTeams: [
        {
          apiId: team.id,
          name: team.name,
          logo: team.logo,
          seasons: [
            {
              season: body.season,
              competitions: [
                {
                  apiId: body.league,
                  games: [],
                  logo: competition.league.logo,
                  name: competition.league.name,
                  players: [],
                  standings: mapStandings(competition),
                  teamStatistics: mapTeamStatistics(teamStatistics),
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      logger.info('Fetching an upcoming game for the group.');
      const upcomingGame = await findUpcomingGame(body.team, [body.league]);
      // Group _id needs to be set manually, as that's not known from the API call
      upcomingGame.groupId = group._id;

      // Save the game in the database, push it into the upcomingGames array,
      // and save the group object with updated information.
      const game = await Game.create(upcomingGame);
      group.upcomingGames.push(game._id);
    } catch (error) {
      logger.error(
        `An error occured while fetching an upcoming game for the group. ` +
          `Error: ${error}`
      );
      throw error;
    }

    await group.save();

    logger.info(`A new group ${group.name} (${group._id}) was created.`);
    res.status(200).json(group);
  } catch (error) {
    logger.error(`Couldn't create a new group. Error: ${error}`);
    res.status(500).json('Internal server error');
  }
});

export default router;
