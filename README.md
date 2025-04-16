Run the following command to build and start the containers:
docker-compose up --build

Access the Node.js app at:
http://localhost:8000

Stop all running containers:
docker-compose down



Disable ESLint for the entire file	/* eslint-disable */
Disable specific rules for file	/* eslint-disable no-console */
Disable ESLint for one line	// eslint-disable-line no-console
Disable ESLint for the next line	/* eslint-disable-next-line no-console */
Disable ESLint for a block	/* eslint-disable */ ... /* eslint-enable */