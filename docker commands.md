### Use these to reset docker
```sh
docker compose down --volumes --rmi all
docker builder prune -a
```

### Use this to start docker
```sh
clear && docker compose up --build
```