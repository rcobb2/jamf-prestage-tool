# Use the official Node.js image as the base image
FROM node:lts-slim AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY ./client/package.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY ./client/. .

# Run TypeScript compile
RUN npx tsc --project ./tsconfig.json

# Pass build-time arguments
ARG REACT_APP_SERVER_URL
ARG REACT_APP_CLIENT_ID
ARG REACT_APP_TENANT_ID

# Ensure build arguments are passed to the environment variables
ENV REACT_APP_SERVER_URL=${REACT_APP_SERVER_URL}
ENV REACT_APP_CLIENT_ID=${REACT_APP_CLIENT_ID}
ENV REACT_APP_TENANT_ID=${REACT_APP_TENANT_ID}

# Build the React app
RUN npm run build

# Use a lightweight web server to serve the static files
FROM nginx:stable-bookworm

# Copy the build output
COPY --from=build /app/build /usr/share/nginx/html

# Copy SSL certificates and Nginx configuration
COPY server.key /etc/ssl/private/server.key
COPY server.cert /etc/ssl/certs/server.cert
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose the HTTPS port
EXPOSE 443

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]