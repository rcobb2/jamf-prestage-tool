# Use the official Node.js image as the base image
FROM node:lts-slim AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY ./server/package.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY ./server/. .

# Run TypeScript compile
RUN npx tsc --project ./tsconfig.json

# Expose the port the server will run on
EXPOSE 443

# Start the server
CMD ["npm", "start"]