# Monitoring Job
Monitors Fluid production health via a cron job.

To build locally
```
docker build --build-arg NPM_TOKEN=$(echo $NPM_TOKEN) -t monitoring .
```

And to run locally
```
`docker run --rm -t monitoring`
```


Building and pushing to Fluid registry
```
docker build --build-arg NPM_TOKEN=$(echo $NPM_TOKEN) -t prague.azurecr.io/monitoring .
docker push prague.azurecr.io/monitoring
```

Scheduling cron job
```
cd deployment
kubectl apply -f cronjob.yaml
```

To see cron job schedule and instances
```
kubectl get cronjobs
kubectl get jobs
```

To list the pods running this job
```
kubectl get pods --selector=app=service-monitoring
```

To view the output of a job pod instance
```
kubectl logs <pod_name>
```

To delete an existing job
```
kubectl delete cronjob service-monitoring
```

